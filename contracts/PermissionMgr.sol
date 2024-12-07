// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract PermissionManager {
    // global variables
    uint256 public ROUND_BLOCKS; // 每轮次持续的区块数
    uint256 public ROUND_TIMEOUT; // 超时（秒）
    uint256 public MIN_DEPOSIT; // 最小保证金

    // Structs
    struct Node {
        bool isPermissioned; // 是否是权限节点
        uint256 deposit; // 节点保证金
        bool active; // 节点是否活跃
        bytes32 publicKey; // 节点提交的公钥
    }

    struct Round {
        uint256 startBlock; // 轮次起始区块号
        uint256 timeout; // 轮次超时
        uint256 publicKeyCount; // 收集到的公钥数量
        address[] activeNodes; // 当前轮次的活跃节点
        mapping(address => bytes32) publicKeys; // 节点地址到公钥映射
        bytes32 systemPublicKey; // 系统公钥
    }

    // State Variables
    address public owner;
    uint256 public currentRoundIndex = 0;
    mapping(address => Node) public nodes; // 节点地址到节点信息的映射
    Round[] public rounds; // 所有轮次记录
    address[] public pendingNodes; // 待审批节点
    address[] public leavingNodes; // 待离开节点
    mapping(address => mapping(address => bool)) public joinApprovals; // 新节点 -> 审批节点 -> 是否已投票
    mapping(address => mapping(address => bool)) public leaveApprovals; // 离开节点 -> 审批节点 -> 是否已投票
    mapping(uint256 => mapping(address => uint256)) public approvalCounts; // 轮次 -> 节点 -> 已收到的投票数
    mapping(address => uint256) public leaveApprovalsCount; // 离开节点 -> 已收到的投票数

    // Events
    event NodeJoinProposed(address indexed node,uint256 indexed roundIndex);
    event NodeJoined(address indexed node,uint256 indexed roundIndex);
    event NodeLeaveProposed(address indexed node,uint256 indexed roundIndex);
    event NodeLeft(address indexed node,uint256 indexed roundIndex);
    event SystemPublicKeyGenerated(uint256 indexed roundIndex, bytes32 systemPublicKey, address[] participants);

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
    constructor(uint256 _roundBlocks, uint256 _roundTimeout, uint256 _minDeposit) {
        owner = msg.sender;
        ROUND_BLOCKS = _roundBlocks;
        ROUND_TIMEOUT = _roundTimeout;
        MIN_DEPOSIT = _minDeposit;
        _startNewRound();
    }

    // Node Management
    function proposeJoinNode() external payable {
        require(!nodes[msg.sender].isPermissioned, "Already a permissioned node");
        require(msg.value >= MIN_DEPOSIT, "Deposit required");

        nodes[msg.sender] = Node(false, msg.value, false, "");
        pendingNodes.push(msg.sender);

        emit NodeJoinProposed(msg.sender,currentRoundIndex);

        if(rounds[currentRoundIndex].activeNodes.length == 0) {
            _finalizeJoinNode(msg.sender);
        }
    }

    function approveJoinNode(address _node) external onlyPermissioned(msg.sender) {
        require(_isPendingNode(_node), "Node not proposed for join");
        require(!_hasApproved(msg.sender, _node), "Already approved");

        joinApprovals[_node][msg.sender] = true;
        approvalCounts[currentRoundIndex][_node]++;

        uint256 approvalThreshold = rounds[currentRoundIndex].activeNodes.length;
        if (approvalCounts[currentRoundIndex][_node] >= (approvalThreshold / 2)) {
            _finalizeJoinNode(_node);
        }
    }

    function proposeLeaveNode() external onlyPermissioned(msg.sender) {
        require(nodes[msg.sender].active, "Node not active");

        nodes[msg.sender].active = false;
        leavingNodes.push(msg.sender);
        emit NodeLeaveProposed(msg.sender,currentRoundIndex);

        if(rounds[currentRoundIndex].activeNodes.length == 1) {
            _finalizeLeaveNode(msg.sender);
        }
    }

    function approveLeaveNode(address _node) external onlyPermissioned(msg.sender) {
        require(_isLeavingNode(_node), "Node not proposed for leave");
        require(!_hasApprovedToLeave(msg.sender, _node), "Already approved to leave");

        leaveApprovals[_node][msg.sender] = true;
        leaveApprovalsCount[_node]++;

        uint256 approvalThreshold = rounds[currentRoundIndex].activeNodes.length;
        if (leaveApprovalsCount[_node] >= (approvalThreshold / 2)) {
            _finalizeLeaveNode(_node);
        }
    }

    // Public Key Management
    function submitPubKey(bytes32 _pubKey,uint256 _round) external onlyPermissioned(msg.sender) {
        require(_round ==  currentRoundIndex, "Round mismatch");
        Round storage currentRound = rounds[currentRoundIndex];
        require(currentRound.publicKeys[msg.sender].length == 0, "Already submitted public key");
        require(block.timestamp <= currentRound.timeout, "Round timed out");

        currentRound.publicKeys[msg.sender] = _pubKey;
        currentRound.publicKeyCount++;

        // 如果收集到足够公钥或者超时，生成系统公钥
        if (currentRound.publicKeyCount >= (currentRound.activeNodes.length / 2) || block.timestamp > currentRound.timeout) {
            _generateSystemPublicKey();
        }
    }

    function getSystemPublicKey(uint256 _round) external view onlyPermissioned(msg.sender) returns (bytes32, address[] memory) {
        return (rounds[_round].systemPublicKey,rounds[_round].activeNodes);
    }

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

    function getPendingNodeNum() external view returns (uint256) {
        return pendingNodes.length;
    }

    // Internal Functions
    function _isPendingNode(address _node) internal view returns (bool) {
        for (uint256 i = 0; i < pendingNodes.length; i++) {
            if (pendingNodes[i] == _node) {
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

    function _hasApproved(address approver, address _node) internal view returns (bool) {
        return joinApprovals[_node][approver];
    }

    function _hasApprovedToLeave(address approver, address _node) internal view returns (bool) {
        return leaveApprovals[_node][approver];
    }

    function _removePendingNode(address _node) internal {
        for (uint256 i = 0; i < pendingNodes.length; i++) {
            if (pendingNodes[i] == _node) {
                pendingNodes[i] = pendingNodes[pendingNodes.length - 1];
                pendingNodes.pop();
                break;
            }
        }
    }

    function _removeLeavingNode(address _node) internal {
        for (uint256 i = 0; i < leavingNodes.length; i++) {
            if (leavingNodes[i] == _node) {
                leavingNodes[i] = leavingNodes[leavingNodes.length - 1];
                leavingNodes.pop();
                break;
            }
        }
    }

    function _finalizeJoinNode(address _node) internal {
        // 移除待审批列表
        _removePendingNode(_node);
        
        nodes[_node].isPermissioned = true;
        nodes[_node].active = true;
        rounds[currentRoundIndex].activeNodes.push(_node);

        emit NodeJoined(_node,currentRoundIndex);
    }

    function _finalizeLeaveNode(address _node) internal {
        // 移除待审批列表
        _removeLeavingNode(_node);

        leaveApprovalsCount[_node] = 0;
        // 清除 leaveApprovals 中有关该节点的投票信息
        for (uint256 i = 0; i < rounds[currentRoundIndex].activeNodes.length; i++) {
            address approver = rounds[currentRoundIndex].activeNodes[i];
            delete leaveApprovals[_node][approver];
        }

        uint256 refund = nodes[_node].deposit;
        nodes[_node].isPermissioned = false;
        payable(_node).transfer(refund);
        emit NodeLeft(_node,currentRoundIndex);
    }

    function _generateSystemPublicKey() internal {
        Round storage currentRound = rounds[currentRoundIndex];

        // 系统公钥生成逻辑（子公钥相乘）
        bytes32 combinedPublicKey = bytes32(uint256(1));
        for (uint256 i = 0; i < currentRound.activeNodes.length; i++) {
            bytes32 nodeKey = currentRound.publicKeys[currentRound.activeNodes[i]];
            if (nodeKey.length > 0) {
                combinedPublicKey = mulBytes32(combinedPublicKey, nodeKey);
            }
        }

        currentRound.systemPublicKey = combinedPublicKey;
        emit SystemPublicKeyGenerated(currentRoundIndex, combinedPublicKey, currentRound.activeNodes);
        _startNewRound();
    }

    // 用于模拟两个 bytes32 的乘法
    function mulBytes32(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        uint256 aInt = uint256(a);
        uint256 bInt = uint256(b);
        uint256 result = aInt * bInt;

        // 确保结果不会溢出
        require(result / aInt == bInt, "Multiplication overflow");
        return bytes32(result);
    }

    function _startNewRound() internal {

        // 清除上一轮的投票信息
        if(currentRoundIndex != 0) {
            _clearJoinApprovals();
        }
        for (uint256 i = 0; i < pendingNodes.length; i++) {
            address node = pendingNodes[i];
            for (uint256 j = 0; j < rounds[currentRoundIndex].activeNodes.length; j++) {
                address approver = rounds[currentRoundIndex].activeNodes[j];
                delete joinApprovals[node][approver];
            }
        }

        uint256 startBlock = block.number;
        uint256 timeout = block.timestamp + ROUND_TIMEOUT;

        Round storage newRound = rounds.push();
        newRound.startBlock = startBlock;
        newRound.timeout = timeout;

        currentRoundIndex = rounds.length - 1;
    }

    function _clearJoinApprovals() internal {
        // 清除 pendingNodes 的投票信息
        for (uint256 i = 0; i < pendingNodes.length; i++) {
            address node = pendingNodes[i];
            for (uint256 j = 0; j < rounds[currentRoundIndex].activeNodes.length; j++) {
                address approver = rounds[currentRoundIndex].activeNodes[j];
                delete joinApprovals[node][approver];
            }
        }

        delete pendingNodes;
    }
}