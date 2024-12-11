import { expect } from "chai";
import hre from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { extendEnvironment } from "hardhat/config";
import { populate } from "dotenv";
  
describe("PermissionManager", function () {
  async function deployPermissionManagerFixture() {
    const ROUND_BLOCKS = 1000;
    const ROUND_TIMEOUT = 12000;
    const MIN_DEPOSIT = hre.ethers.parseEther("0.01");
  
    const [owner, node1, node2, node3, node4] = await hre.ethers.getSigners();
  
    const PermissionManager = await hre.ethers.getContractFactory("PermissionManager");
    const permissionManager = await PermissionManager.deploy(ROUND_BLOCKS, ROUND_TIMEOUT, MIN_DEPOSIT);
  
    return { permissionManager, owner, node1, node2, node3, node4, ROUND_BLOCKS, ROUND_TIMEOUT, MIN_DEPOSIT };
  }
  
  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { permissionManager, owner } = await loadFixture(deployPermissionManagerFixture);
  
      expect(await permissionManager.owner()).to.equal(owner.address);
    });
  
    it("Should set the right initial parameters", async function () {
      const { permissionManager, ROUND_BLOCKS, ROUND_TIMEOUT, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
  
      expect(await permissionManager.ROUND_BLOCKS()).to.equal(ROUND_BLOCKS);
      expect(await permissionManager.ROUND_TIMEOUT()).to.equal(ROUND_TIMEOUT);
      expect(await permissionManager.MIN_DEPOSIT()).to.equal(MIN_DEPOSIT);
    });
  });
  
  describe("Node Management", function () {
    it("Should allow a node to propose join with sufficient deposit", async function () {
      const { permissionManager, node1, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
  
      await expect(permissionManager.connect(node1).proposeJoinNode({ value: MIN_DEPOSIT }))
        .to.emit(permissionManager, "NodeJoinProposed")
        .withArgs(node1.address, 0);
  
      const nodeInfo = await permissionManager.nodes(node1.address);
      expect(nodeInfo.deposit).to.equal(MIN_DEPOSIT);
      expect(nodeInfo.isPermissioned).to.be.true;
      expect(nodeInfo.active).to.be.true;
    });
  
    it("Should not allow a node to propose join with insufficient deposit", async function () {
      const { permissionManager, node1 } = await loadFixture(deployPermissionManagerFixture);
      const deposit = hre.ethers.parseEther("0.005");
  
      await expect(permissionManager.connect(node1).proposeJoinNode({ value: deposit }))
        .to.be.revertedWith("Deposit required");
    });
  
    it("Should allow permissioned nodes to approve join proposals", async function () {
      const { permissionManager, node1, node2, node3, node4, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
  
      await permissionManager.connect(node1).proposeJoinNode({ value: MIN_DEPOSIT });
      await permissionManager.connect(node2).proposeJoinNode({ value: MIN_DEPOSIT });
      await permissionManager.connect(node1).approveJoinNode(node2.address);
  
      const nodeInfo = await permissionManager.nodes(node2.address);
      expect(nodeInfo.isPermissioned).to.be.true;
      expect(nodeInfo.active).to.be.true;

      await permissionManager.connect(node3).proposeJoinNode({ value: MIN_DEPOSIT });
      await permissionManager.connect(node1).approveJoinNode(node3.address);

      const nodeInfo2 = await permissionManager.nodes(node3.address);
      expect(nodeInfo2.isPermissioned).to.be.true;
      expect(nodeInfo2.active).to.be.true;

      const activeNum = await permissionManager.connect(node1).getActiveNodeNum(0);
      expect(activeNum).to.equal(3);

      await permissionManager.connect(node4).proposeJoinNode({ value: MIN_DEPOSIT });
      await permissionManager.connect(node1).approveJoinNode(node4.address);
      const nodeInfo3 = await permissionManager.nodes(node4.address);

      const pendingNum = await permissionManager.connect(node1).getPendingNodeNum();
      expect(pendingNum).to.equal(1);
      expect(nodeInfo3.isPermissioned).to.be.false;
      expect(nodeInfo3.active).to.be.false;

      await permissionManager.connect(node2).approveJoinNode(node4.address);
      const nodeInfo4 = await permissionManager.nodes(node4.address);
      expect(nodeInfo4.isPermissioned).to.be.true;
      expect(nodeInfo4.active).to.be.true;
    });
  
    it("Should allow a node to propose leave", async function () {
      const { permissionManager, node1, node2, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
  
      await permissionManager.connect(node1).proposeJoinNode({ value: MIN_DEPOSIT });
      await permissionManager.connect(node2).proposeJoinNode({ value: MIN_DEPOSIT });
      await permissionManager.connect(node1).approveJoinNode(node2.address);
  
      await expect(permissionManager.connect(node2).proposeLeaveNode())
        .to.emit(permissionManager, "NodeLeaveProposed")
        .withArgs(node2.address, 0);
  
      const nodeInfo = await permissionManager.nodes(node2.address);
      expect(nodeInfo.active).to.be.false;
      expect(nodeInfo.isPermissioned).to.be.true;
    });
  
    it("Should allow permissioned nodes to approve leave proposals", async function () {
      const { permissionManager, node1, node2, node3, node4, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
  
      await permissionManager.connect(node1).proposeJoinNode({ value: MIN_DEPOSIT });
      await permissionManager.connect(node2).proposeJoinNode({ value: MIN_DEPOSIT });
      await permissionManager.connect(node1).approveJoinNode(node2.address);
      await permissionManager.connect(node3).proposeJoinNode({ value: MIN_DEPOSIT });
      await permissionManager.connect(node1).approveJoinNode(node3.address);
      await permissionManager.connect(node4).proposeJoinNode({ value: MIN_DEPOSIT });
      await permissionManager.connect(node1).approveJoinNode(node4.address);
      await permissionManager.connect(node2).approveJoinNode(node4.address);
  
      await permissionManager.connect(node4).proposeLeaveNode();
      await permissionManager.connect(node2).approveLeaveNode(node4.address);
      const leavingNum = await permissionManager.connect(node4).getLeavingNodeNum();
      expect(leavingNum).to.equal(1);

      const initialBalance = await hre.ethers.provider.getBalance(node4.address);
      console.log("initialBalance", initialBalance);

      const tx = await permissionManager.connect(node3).approveLeaveNode(node4.address);
      const receipt = await tx.wait();
      
      // 获取TransferGasUsed事件
      const transferEvent = receipt?.logs
        .filter(log => log.topics[0] === permissionManager.interface.getEvent('TransferGasUsed').topicHash)
        .map(log => permissionManager.interface.parseLog(log))[0];
        
      console.log("Transfer Gas Used:", transferEvent?.args.gasUsed);

      const finalBalance = await hre.ethers.provider.getBalance(node4.address);
      console.log("finalBalance", finalBalance);
      const nodeInfo = await permissionManager.nodes(node4.address);
      expect(nodeInfo.isPermissioned).to.be.false;
      expect(nodeInfo.active).to.be.false;

      expect(finalBalance - initialBalance).to.equal(MIN_DEPOSIT);

    });
  });
  
  describe("Public Key Management", function () {
    it("Should allow permissioned nodes to submit public keys", async function () {
      const { permissionManager, owner, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
      
      const node = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
      const uncompressedPubKey = hre.ethers.SigningKey.computePublicKey(node.privateKey,false);

      const pubKey = "0x" + uncompressedPubKey.slice(4,68);
      
      await owner.sendTransaction({
        to: node.address,
        value: hre.ethers.parseEther("0.1")
      });
      
      await permissionManager.connect(node).proposeJoinNode({ value: MIN_DEPOSIT });
  
      const message = hre.ethers.AbiCoder.defaultAbiCoder().encode(["address"], [node.address]);
      const hash = hre.ethers.keccak256(message);
      const signature = await node.signMessage(hre.ethers.getBytes(hash));

      const [isVerified, err, errArg] = await permissionManager.connect(node).verifySignature(signature, node.address);
      expect(isVerified).to.be.true;

      await permissionManager.connect(node).submitPubKey(pubKey, signature, 0);
  
      const nodePubKey = await permissionManager.getRoundPublicKey(0, node.address);
      expect(nodePubKey).to.equal(pubKey);
    });

    it("Should reject invalid signature", async function () {
      const { permissionManager, node1, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);

      await permissionManager.connect(node1).proposeJoinNode({ value: MIN_DEPOSIT });

      const pubKey = hre.ethers.hexlify(hre.ethers.randomBytes(32));
      const signature = hre.ethers.hexlify(hre.ethers.randomBytes(65));
      await expect(
        permissionManager.connect(node1).submitPubKey(pubKey, signature, 0)
      ).to.be.revertedWith("Invalid signature");
    });
  
    it("Should not allow non-permissioned nodes to submit public keys", async function () {
      const { permissionManager, node1 } = await loadFixture(deployPermissionManagerFixture);
  
      const pubKey = hre.ethers.hexlify(hre.ethers.randomBytes(32));
      const signature = hre.ethers.hexlify(hre.ethers.randomBytes(65));
      await expect(
        permissionManager.connect(node1).submitPubKey(pubKey, signature, 0)
      ).to.be.revertedWith("Not a permissioned node");
    });
  
    it("Should not allow submitting public key for wrong round", async function () {
      const { permissionManager, node1, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
  
      await permissionManager.connect(node1).proposeJoinNode({ value: MIN_DEPOSIT });
  
      const pubKey = hre.ethers.hexlify(hre.ethers.randomBytes(32));
      const signature = hre.ethers.hexlify(hre.ethers.randomBytes(65));
      await expect(
        permissionManager.connect(node1).submitPubKey(pubKey, signature, 1)
      ).to.be.revertedWith("Round mismatch");
    });
    
    it("Should not allow submitting public key twice in same round", async function () {
      const { permissionManager, owner, node1, node2, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
      
      const node = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
      const uncompressedPubKey = hre.ethers.SigningKey.computePublicKey(node.privateKey,false);

      const pubKey = "0x" + uncompressedPubKey.slice(4,68);
      
      await owner.sendTransaction({
        to: node.address,
        value: hre.ethers.parseEther("0.1")
      });
      
      await permissionManager.connect(node).proposeJoinNode({ value: MIN_DEPOSIT });
      await permissionManager.connect(node1).proposeJoinNode({ value: MIN_DEPOSIT });
      await permissionManager.connect(node2).proposeJoinNode({ value: MIN_DEPOSIT });

      await permissionManager.connect(node).approveJoinNode(node1.address);
      await permissionManager.connect(node).approveJoinNode(node2.address);
  
      const message = hre.ethers.AbiCoder.defaultAbiCoder().encode(["address"], [node.address]);
      const hash = hre.ethers.keccak256(message);
      const signature = await node.signMessage(hre.ethers.getBytes(hash));

      await permissionManager.connect(node).submitPubKey(pubKey, signature, 0);

      await expect(permissionManager.connect(node).submitPubKey(pubKey, signature, 0)).to.be.revertedWith("Already submitted public key");

    });
  
    it("Should generate system public key when enough public keys are submitted", async function () {
      const { permissionManager, owner, node3, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
      
      const node1 = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
      const uncompressedPubKey = hre.ethers.SigningKey.computePublicKey(node1.privateKey,false);

      const pubKey = "0x" + uncompressedPubKey.slice(4,68);
      
      await owner.sendTransaction({
        to: node1.address,
        value: hre.ethers.parseEther("0.1")
      });

      const node2 = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
      const uncompressedPubKey2 = hre.ethers.SigningKey.computePublicKey(node2.privateKey,false);

      const pubKey2 = "0x" + uncompressedPubKey2.slice(4,68);
      
      await owner.sendTransaction({
        to: node2.address,
        value: hre.ethers.parseEther("0.1")
      });
      
      await permissionManager.connect(node1).proposeJoinNode({ value: MIN_DEPOSIT });
      await permissionManager.connect(node2).proposeJoinNode({ value: MIN_DEPOSIT });
      await permissionManager.connect(node3).proposeJoinNode({ value: MIN_DEPOSIT });

      await permissionManager.connect(node1).approveJoinNode(node2.address);
      await permissionManager.connect(node1).approveJoinNode(node3.address);
  
      const message = hre.ethers.AbiCoder.defaultAbiCoder().encode(["address"], [node1.address]);
      const hash = hre.ethers.keccak256(message);
      const signature = await node1.signMessage(hre.ethers.getBytes(hash));

      await permissionManager.connect(node1).submitPubKey(pubKey, signature, 0);

      const message2 = hre.ethers.AbiCoder.defaultAbiCoder().encode(["address"], [node2.address]);
      const hash2 = hre.ethers.keccak256(message2);
      const signature2 = await node2.signMessage(hre.ethers.getBytes(hash2));

      await expect(permissionManager.connect(node2).submitPubKey(pubKey2, signature2, 0)).to.emit(permissionManager, "SystemPublicKeyGenerated")
        .withArgs(0, [pubKey, pubKey2], [node1.address, node2.address]);
    });
  
    it("Should allow getting system public key for a round", async function () {
      const { permissionManager, owner, node3, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
      
      const node1 = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
      const uncompressedPubKey = hre.ethers.SigningKey.computePublicKey(node1.privateKey,false);

      const pubKey = "0x" + uncompressedPubKey.slice(4,68);
      
      await owner.sendTransaction({
        to: node1.address,
        value: hre.ethers.parseEther("0.1")
      });

      const node2 = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
      const uncompressedPubKey2 = hre.ethers.SigningKey.computePublicKey(node2.privateKey,false);

      const pubKey2 = "0x" + uncompressedPubKey2.slice(4,68);
      
      await owner.sendTransaction({
        to: node2.address,
        value: hre.ethers.parseEther("0.1")
      });
      
      await permissionManager.connect(node1).proposeJoinNode({ value: MIN_DEPOSIT });
      await permissionManager.connect(node2).proposeJoinNode({ value: MIN_DEPOSIT });
      await permissionManager.connect(node3).proposeJoinNode({ value: MIN_DEPOSIT });

      await permissionManager.connect(node1).approveJoinNode(node2.address);
      await permissionManager.connect(node1).approveJoinNode(node3.address);
  
      const message = hre.ethers.AbiCoder.defaultAbiCoder().encode(["address"], [node1.address]);
      const hash = hre.ethers.keccak256(message);
      const signature = await node1.signMessage(hre.ethers.getBytes(hash));

      await permissionManager.connect(node1).submitPubKey(pubKey, signature, 0);

      const message2 = hre.ethers.AbiCoder.defaultAbiCoder().encode(["address"], [node2.address]);
      const hash2 = hre.ethers.keccak256(message2);
      const signature2 = await node2.signMessage(hre.ethers.getBytes(hash2));

      await permissionManager.connect(node2).submitPubKey(pubKey2, signature2, 0);

      const [publicKeys, nodesList] = await permissionManager.connect(node1).getSystemPublicKey(0);
      expect(publicKeys).to.deep.equal([pubKey, pubKey2]);
      expect(nodesList).to.deep.equal([node1.address, node2.address]);
    });
  });
});