// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

// Uncomment this line to use console.log
import "hardhat/console.sol";
// import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
// import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract PermissionManagerV2 {

    // using ECDSA for bytes32;

    // global variables
    uint256 public ROUND_BLOCKS; // 每轮次持续的区块数
    uint256 public ROUND_TIMEOUT; // 超时（秒）
    uint256 public MIN_DEPOSIT; // 最小保证金
    uint256 public MAX_VALIDATORS; // 最大验证者数量

    // Structs
    struct Node {
        bool isPermissioned; // 是否是权限节点
        uint256 deposit; // 节点保证金
        bool active; // 节点是否活跃
        bytes32 publicKey; // 节点提交的公钥
        uint256 totalStake; // 总质押量(包括自质押和委托)
        uint256 selfStake; // 自质押量
    }

    struct Round {
        uint256 startBlock; // 轮次起始区块号
        uint256 timeout; // 轮次超时
        uint256 publicKeyCount; // 收集到的公钥数量
        address[] activeNodes; // 当前轮次的活跃节点
        mapping(address => bytes32) publicKeys; // 节点地址到公钥映射
        bool isGenerated; // 系统公钥是否已生成
    }

    struct Delegate {
        address delegator;
        uint256 amount;
    }

    // State Variables
    address public owner;
    uint256 public currentRoundIndex = 0;
    mapping(address => Node) public nodes; // 节点地址到节点信息的映射
    mapping(address => Delegate[]) public delegations; // 节点到其被委托质押信息的映射
    Round[] public rounds; // 所有轮次记录
    address[] public candidates; // 已提交保证金的候选人列表
    address[] public leavingNodes; // 主动提出要退出的验证者列表
    address[] public validators; // 当前验证者列表

    // Events
    event NodeElectionProposed(address indexed node,uint256 indexed roundIndex);
    event NodeLeaveProposed(address indexed node,uint256 indexed roundIndex);
    event SystemPublicKeyGenerated(uint256 indexed roundIndex, bytes32[] publicKeys, address[] participants);
    event TransferGasUsed(address indexed node, uint256 amount, uint256 gasUsed);
    event Staked(address indexed staker, uint256 amount);
    event Delegated(address indexed delegator, address indexed validator, uint256 amount);
    event RevokeDelegated(address indexed delegator, address indexed valildator, uint256 amounToRevoke);
    event ValidatorUpdated(address indexed validator, bool added);

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Not contract owner");
        _;
    }

    modifier onlyPermissioned(address _node) {
        require(nodes[_node].isPermissioned, "Not a permissioned node");
        _;
    }

    // Constructor
    constructor(uint256 _roundBlocks, uint256 _roundTimeout, uint256 _minDeposit, uint256 _maxValidators) {
        owner = msg.sender;
        ROUND_BLOCKS = _roundBlocks;
        ROUND_TIMEOUT = _roundTimeout;
        MIN_DEPOSIT = _minDeposit;
        MAX_VALIDATORS = _maxValidators;
        _startNewRound();
    }

    // Node Management
    function proposeElection() external payable {
        require(!nodes[msg.sender].isPermissioned, "Already a permissioned node");
        require(msg.value >= MIN_DEPOSIT, "Deposit required");

        nodes[msg.sender] = Node({
            isPermissioned: false,
            deposit: msg.value,
            active: false,
            publicKey: "",
            totalStake: 0,
            selfStake: 0
        });
        
        candidates.push(msg.sender);
        emit NodeElectionProposed(msg.sender, currentRoundIndex);
    }

    function proposeLeave() external onlyPermissioned(msg.sender) {
        require(nodes[msg.sender].active, "Node not active");

        nodes[msg.sender].active = false;
        leavingNodes.push(msg.sender);
        emit NodeLeaveProposed(msg.sender,currentRoundIndex);

    }

    // Public Key Management
    function submitPubKey(bytes32 _pubKey, bytes memory _signature, uint256 _round) external onlyPermissioned(msg.sender) {
        require(_round ==  currentRoundIndex, "Round mismatch");
        Round storage currentRound = rounds[currentRoundIndex];
        require(currentRound.publicKeys[msg.sender] == bytes32(0), "Already submitted public key");
        require(block.timestamp <= currentRound.timeout, "Round timed out");

        // (bool isVerified, ECDSA.RecoverError err, bytes32 errArg) = verifySignature(_signature, msg.sender);
        // require(isVerified && err == ECDSA.RecoverError.NoError && errArg == bytes32(0), "Invalid signature");

        currentRound.publicKeys[msg.sender] = _pubKey;
        currentRound.publicKeyCount++;

        // 如果收集到足够公钥或者超时，生成系统公钥
        if (currentRound.publicKeyCount * 2 >= currentRound.activeNodes.length || block.timestamp > currentRound.timeout) {
            _generateSystemPublicKey();
        }
    }

    // function verifySignature(bytes memory _signature, address _node) public pure returns (bool, ECDSA.RecoverError, bytes32) {

    //     bytes32 messageHash = keccak256(abi.encode(_node));
    //     bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);

    //     (address recoveredAddress, ECDSA.RecoverError err, bytes32 errArg) = ECDSA.tryRecover(ethSignedMessageHash, _signature);
    //     bool isVerified = true;
    //     if(err != ECDSA.RecoverError.NoError || errArg != bytes32(0)) {
    //         return (false, err, errArg);
    //     }
    //     isVerified = recoveredAddress == _node;
    //     return (isVerified, err, errArg);
    // }

    function setRoundBlocks(uint256 _roundBlocks) external onlyOwner {
        ROUND_BLOCKS = _roundBlocks;
    }

    function setRoundTimeout(uint256 _roundTimeout) external onlyOwner {
        ROUND_TIMEOUT = _roundTimeout;
    }

    function setMinDeposit(uint256 _minDeposit) external onlyOwner {
        MIN_DEPOSIT = _minDeposit;
    }

    function getActiveNodeNum(uint256 _round) external view returns (uint256) {
        return rounds[_round].activeNodes.length;
    }

    function getCandidatesNum() external view returns (uint256) {
        return candidates.length;
    }

    function getValidatorsNum() external view returns (uint256) {
        return validators.length;
    }

    function getLeavingNodeNum() external view returns (uint256) {
        return leavingNodes.length;
    }

    function getRoundPublicKey(uint256 _round, address _node) external view returns (bytes32) {
        return rounds[_round].publicKeys[_node];
    }

    function getSystemPublicKey(uint256 _round) public view onlyPermissioned(msg.sender) returns (bytes32[] memory, address[] memory) {
        bytes32[] memory publicKeys = new bytes32[](rounds[_round].publicKeyCount);
        address[] memory nodesList = new address[](rounds[_round].publicKeyCount);
        for(uint256 i = 0; i < rounds[_round].publicKeyCount; i++) {
            if(rounds[_round].publicKeys[rounds[_round].activeNodes[i]] != bytes32(0)) {
                publicKeys[i] = rounds[_round].publicKeys[rounds[_round].activeNodes[i]];
                nodesList[i] = rounds[_round].activeNodes[i];
            }
        }
        return (publicKeys,nodesList);
    }

    // 新增质押函数
    function stake() external payable {
        require(msg.value > 0, "Must stake positive amount");

        Node storage node = nodes[msg.sender];
        node.selfStake += msg.value;
        node.totalStake += msg.value;

        emit Staked(msg.sender, msg.value);
    }

    // 新增委托函数
    function delegate(address validator) external payable {
        require(msg.value > 0, "Must delegate positive amount");

        Node storage node = nodes[validator];
        node.totalStake += msg.value;
        bool hasDelegated = false;

        for(uint256 i = 0; i < delegations[validator].length; i++) {
            if(delegations[validator][i].delegator == msg.sender) {
                delegations[validator][i].amount += msg.value;
                hasDelegated = true;
                break;
            }
        }

        if(!hasDelegated){
            // 创建新的 Delegate 结构体并添加到 delegations 数组
            Delegate memory d = Delegate({
                delegator: msg.sender,
                amount: msg.value
            });
            delegations[validator].push(d);
        }

        emit Delegated(msg.sender, validator, msg.value);
    }

    // 新增撤销委托函数
    function revokeDelegation(address delegator, uint256 amountToRevoke) external {
        
        bool hasFindRecord = false;
        Node storage node = nodes[delegator];

        // 查找用户的委托记录
        for (uint256 i = 0; i < delegations[delegator].length; i++) {
            if (delegations[delegator][i].delegator == msg.sender) {
                hasFindRecord = true;
                if (amountToRevoke > delegations[delegator][i].amount) revert("Amount to revoke exceeds delegated amount");

                // 退还委托金额
                delegations[delegator][i].amount -= amountToRevoke;
                node.totalStake -= amountToRevoke;
                payable(msg.sender).transfer(amountToRevoke);

                if (delegations[delegator][i].amount == 0) {
                    // 如果委托金额为0，移除该委托记录
                    delegations[delegator][i] = delegations[delegator][delegations[delegator].length - 1]; // 用最后一个替换当前
                    delegations[delegator].pop(); // 移除最后一个元素
                }
                break;
            }
        }

        if(!hasFindRecord) revert("No delegation record found");

        emit RevokeDelegated(msg.sender, delegator, amountToRevoke);
    }

    function startElection() external onlyOwner {
        require(block.timestamp > rounds[currentRoundIndex].timeout || currentRoundIndex == 0, "Round not timed out");
        _startNewRound();
    }

    // Internal Functions
    function _isCandidate(address _node) internal view returns (bool) {
        for (uint256 i = 0; i < candidates.length; i++) {
            if (candidates[i] == _node) {
                return true;
            }
        }
        return false;
    }

    // 辅助函数，检查地址是否在验证者列表中
    function _isInValidators(address _node) internal view returns (bool) {
        for (uint256 i = 0; i < validators.length; i++) {
            if (validators[i] == _node) {
                return true;
            }
        }
        return false;
    }

    function _isLeavingNode(address _node) internal view returns (bool) {
        for (uint256 i = 0; i < leavingNodes.length; i++) {
            if (leavingNodes[i] == _node) {
                return true;
            }
        }
        return false;
    }

    function _generateSystemPublicKey() internal {
        Round storage currentRound = rounds[currentRoundIndex];
        currentRound.isGenerated = true;

        bytes32[] memory publicKeys = new bytes32[](currentRound.publicKeyCount);
        address[] memory nodesList = new address[](currentRound.publicKeyCount);
        (publicKeys, nodesList) = getSystemPublicKey(currentRoundIndex);

        emit SystemPublicKeyGenerated(currentRoundIndex, publicKeys, nodesList);
        _startNewRound();
    }

    function _startNewRound() internal {
        uint256 startBlock = block.number;
        uint256 timeout = block.timestamp + ROUND_TIMEOUT;

        Round storage newRound = rounds.push();
        newRound.startBlock = startBlock;
        newRound.timeout = timeout;

        currentRoundIndex = rounds.length - 1;

        // 在新轮次开始时更新验证者列表
        _updateValidators();
    }

    // 更新验证者列表
    function _updateValidators() internal {

        if(currentRoundIndex == 0) return;
        
        // 处理上一轮次中提出退出的验证者节点
        if(leavingNodes.length > 0) {
            for (uint256 i = 0; i < leavingNodes.length; i++) {
                address leavingNode = leavingNodes[i];
                // 如果该节点在当前验证者列表中，移除它
                if (_isInValidators(leavingNode)) {
                    // 将其标记为不再是权限节点
                    nodes[leavingNode].isPermissioned = false;
                    nodes[leavingNode].active = false;
                    emit ValidatorUpdated(leavingNode, false);

                    // 退款：将保证金和自质押数量退还给该节点
                    uint256 refund = nodes[leavingNode].deposit + nodes[leavingNode].selfStake;
                    nodes[leavingNode].deposit = 0;
                    nodes[leavingNode].totalStake = 0;
                    nodes[leavingNode].selfStake = 0;
                    payable(leavingNode).transfer(refund);

                    // 退还委托给该验证者的质押数量
                    for (uint256 j = 0; j < delegations[leavingNode].length; j++) {
                        Delegate memory d = delegations[leavingNode][j];
                        // 退还委托金额
                        uint256 amount = d.amount;
                        d.amount = 0;
                        payable(d.delegator).transfer(amount);
                        // 清除委托记录
                        delete delegations[leavingNode][j];
                    }
                }
            }
            
            // 清空离开节点列表
            delete leavingNodes;
        }
    
        // 创建临时数组存储所有节点
        address[] memory allNodes = new address[](validators.length + candidates.length);
        uint256 count = 0;
        
        // 收集所有节点
        for(uint i = 0; i < validators.length; i++) {
            if(nodes[validators[i]].isPermissioned) allNodes[count++] = validators[i];
        }
        for(uint i = 0; i < candidates.length; i++) {
            allNodes[count++] = candidates[i];
        }

        // 按总质押量排序
        for(uint i = 0; i < count - 1; i++) {
            for(uint j = i + 1; j < count; j++) {
                if(nodes[allNodes[j]].totalStake > nodes[allNodes[i]].totalStake) {
                    address temp = allNodes[i];
                    allNodes[i] = allNodes[j];
                    allNodes[j] = temp;
                }
            }
        }

        // 清空当前验证者列表和候选者列表
        delete validators;
        delete candidates;

        // 选择前MAX_VALIDATORS个节点作为新的验证者
        for(uint i = 0; i < count && i < MAX_VALIDATORS; i++) {
            address validator = allNodes[i];
            validators.push(validator);
                
            // 如果节点未成为权限节点且质押足够，将其升级为权限节点
            if(!nodes[validator].isPermissioned && nodes[validator].deposit >= MIN_DEPOSIT) {
                nodes[validator].isPermissioned = true;
                nodes[validator].active = true;
                emit ValidatorUpdated(validator, true);
            }
        }

        // 更新候选人列表，直接从第MAX_VALIDATORS+1名开始
        if(count > MAX_VALIDATORS) {
            // 创建新的 candidates 列表
            address[] memory newCandidates = new address[](count - MAX_VALIDATORS);
            for (uint256 i = MAX_VALIDATORS; i < count; i++) {
                address candidate = allNodes[i];
                newCandidates[i - MAX_VALIDATORS] = candidate;
            }
            candidates = newCandidates;
        }

        // 更新Round中的activeNodes
        Round storage currentRound = rounds[currentRoundIndex];
        currentRound.activeNodes = validators;
    }
}