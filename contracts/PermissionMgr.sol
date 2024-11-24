// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract PermissionManager {
    // Constants
    uint256 public constant ROUND_BLOCKS = 1000; // 每轮次持续的区块数
    uint256 public constant ROUND_TIMEOUT = 12000; // 超时（秒）
    uint256 public constant MIN_DEPOSIT = 1 ether; // 最小保证金

    // Structs
    struct Node {
        bool isPermissioned; // 是否是权限节点
        uint256 deposit; // 节点保证金
        bool active; // 节点是否活跃
        bytes publicKey; // 节点提交的公钥
    }

    struct Round {
        uint256 startBlock; // 轮次起始区块号
        uint256 timeout; // 轮次超时
        uint256 publicKeyCount; // 收集到的公钥数量
        address[] activeNodes; // 当前轮次的活跃节点
        mapping(address => bytes) publicKeys; // 节点地址到公钥映射
        bytes systemPublicKey; // 系统公钥
    }

    // State Variables
    address public owner;
    uint256 public nodeCount;
    uint256 public currentRoundIndex;
    mapping(address => Node) public nodes; // 节点地址到节点信息的映射
    Round[] public rounds; // 所有轮次记录
    address[] public pendingNodes; // 待审批节点
    mapping(address => mapping(address => bool)) public joinApprovals; // 新节点 -> 审批节点 -> 是否已投票

    // Events
    event NodeProposed(address indexed node);
    event NodeJoined(address indexed node);
    event NodeLeft(address indexed node);
    event SystemPublicKeyGenerated(uint256 indexed roundIndex, bytes systemPublicKey, address[] participants);

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
    constructor() {
        owner = msg.sender;
        _startNewRound();
    }

    // Node Management
    function proposeJoinNode() external payable {
        require(!nodes[msg.sender].isPermissioned, "Already a permissioned node");
        require(msg.value > MIN_DEPOSIT, "Deposit required");

        nodes[msg.sender] = Node(false, msg.value, false, "");
        pendingNodes.push(msg.sender);

        emit NodeProposed(msg.sender);
    }

    function approveJoinNode(address _node) external onlyPermissioned(msg.sender) {
        require(!_hasApproved(msg.sender, _node), "Already approved");
        require(nodes[_node].deposit > MIN_DEPOSIT, "Node not proposed for join");

        joinApprovals[_node][msg.sender] = true;

        uint256 approvalCount = _getApprovalCount(_node);
        if (approvalCount >= (nodeCount / 2)) {
            _finalizeJoinNode(_node);
        }
    }

    //TODO
    function leaveNode() external onlyPermissioned(msg.sender) {
        require(nodes[msg.sender].active, "Node not active");

        // 投票机制实现
        uint256 approvalCount = _getApprovalCount(msg.sender);
        require(approvalCount >= (rounds[currentRoundIndex].activeNodes.length / 2), "Insufficient votes");

        uint256 refund = nodes[msg.sender].deposit;
        nodes[msg.sender].active = false;
        nodes[msg.sender].isPermissioned = false;
        payable(msg.sender).transfer(refund);
        emit NodeLeft(msg.sender);
    }

    // Public Key Management
    function submitPublicKey(bytes calldata _publicKey) external onlyPermissioned(msg.sender) {
        Round storage currentRound = rounds[currentRoundIndex];
        require(currentRound.publicKeys[msg.sender].length == 0, "Already submitted public key");
        require(block.timestamp <= currentRound.timeout, "Round timed out");

        currentRound.publicKeys[msg.sender] = _publicKey;
        currentRound.publicKeyCount++;

        // 如果收集到足够公钥或者超时，生成系统公钥
        if (currentRound.publicKeyCount >= (currentRound.activeNodes.length / 2) || block.timestamp > currentRound.timeout) {
            _generateSystemPublicKey();
        }
    }

    function getSystemPublicKey() external view returns (bytes memory) {
        return rounds[currentRoundIndex].systemPublicKey;
    }

    // Internal Functions
    function _getApprovalCount(address _node) internal view returns (uint256 count) {
        for (uint256 i = 0; i < rounds[currentRoundIndex].activeNodes.length; i++) {
            if (rounds[currentRoundIndex].activeNodes[i] != _node) {
                count++;
            }
        }
    }

    function _hasApproved(address approver, address _node) internal view returns (bool) {
        return joinApprovals[_node][approver];
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
    function _finalizeJoinNode(address _node) internal {
        nodes[_node].isPermissioned = true;
        nodes[_node].active = true;
        rounds[currentRoundIndex].activeNodes.push(_node);
        nodeCount++;

        // 移除待审批列表
        _removePendingNode(_node);

        emit NodeJoined(_node);
    }

    function _generateSystemPublicKey() internal {
        Round storage currentRound = rounds[currentRoundIndex];

        // 系统公钥生成逻辑（这里简化为拼接所有公钥）
        bytes memory combinedPublicKey;
        for (uint256 i = 0; i < currentRound.activeNodes.length; i++) {
            bytes memory nodeKey = currentRound.publicKeys[currentRound.activeNodes[i]];
            if (nodeKey.length > 0) {
                combinedPublicKey = abi.encodePacked(combinedPublicKey, nodeKey);
            }
        }

        currentRound.systemPublicKey = combinedPublicKey;
        emit SystemPublicKeyGenerated(currentRoundIndex, combinedPublicKey, currentRound.activeNodes);
        _startNewRound();
    }

    function _startNewRound() internal {
        uint256 startBlock = block.number;
        uint256 timeout = block.timestamp + ROUND_TIMEOUT;

        Round storage newRound = rounds.push();
        newRound.startBlock = startBlock;
        newRound.timeout = timeout;

        currentRoundIndex = rounds.length - 1;
    }
}