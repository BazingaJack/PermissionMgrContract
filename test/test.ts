import { expect } from "chai";
import hre from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { extendEnvironment } from "hardhat/config";
  
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

      // await permissionManager.connect(node2).approveJoinNode(node4.address);
      // const nodeInfo4 = await permissionManager.nodes(node4.address);
      // expect(nodeInfo4.isPermissioned).to.be.true;
      // expect(nodeInfo4.active).to.be.true;

    });
  
    // it("Should allow a node to propose leave", async function () {
    //   const { permissionManager, owner, node1, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
  
    //   await permissionManager.connect(node1).proposeJoinNode({ value: MIN_DEPOSIT });
    //   await permissionManager.connect(owner).approveJoinNode(node1.address);
  
    //   await expect(permissionManager.connect(node1).proposeLeaveNode())
    //     .to.emit(permissionManager, "NodeLeaveProposed")
    //     .withArgs(node1.address, 0);
  
    //   const nodeInfo = await permissionManager.nodes(node1.address);
    //   expect(nodeInfo.active).to.be.false;
    // });
  
    // it("Should allow permissioned nodes to approve leave proposals", async function () {
    //   const { permissionManager, owner, node1, node2, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
  
    //   await permissionManager.connect(node1).proposeJoinNode({ value: MIN_DEPOSIT });
    //   await permissionManager.connect(owner).approveJoinNode(node1.address);
  
    //   await permissionManager.connect(node1).proposeLeaveNode();
    //   await permissionManager.connect(owner).approveLeaveNode(node1.address);
  
    //   const nodeInfo = await permissionManager.nodes(node1.address);
    //   expect(nodeInfo.isPermissioned).to.be.false;
    // });
  });
  
  // describe("Public Key Management", function () {
  //   it("Should allow permissioned nodes to submit public keys", async function () {
  //     const { permissionManager, owner, node1, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
  
  //     await permissionManager.connect(node1).proposeJoinNode({ value: MIN_DEPOSIT });
  //     await permissionManager.connect(owner).approveJoinNode(node1.address);
  
  //     const pubKey = hre.ethers.utils.formatBytes32String("publicKey");
  //     await permissionManager.connect(node1).submitPubKey(pubKey, 0);
  
  //     const round = await permissionManager.rounds(0);
  //     expect(round.publicKeys[node1.address]).to.equal(pubKey);
  //   });
  
  //   it("Should generate system public key when enough public keys are submitted", async function () {
  //     const { permissionManager, owner, node1, node2, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
  
  //     await permissionManager.connect(node1).proposeJoinNode({ value: MIN_DEPOSIT });
  //     await permissionManager.connect(owner).approveJoinNode(node1.address);
  
  //     await permissionManager.connect(node2).proposeJoinNode({ value: MIN_DEPOSIT });
  //     await permissionManager.connect(owner).approveJoinNode(node2.address);
  
  //     const pubKey1 = hre.ethers.utils.formatBytes32String("publicKey1");
  //     const pubKey2 = hre.ethers.utils.formatBytes32String("publicKey2");
  
  //     await permissionManager.connect(node1).submitPubKey(pubKey1, 0);
  //     await permissionManager.connect(node2).submitPubKey(pubKey2, 0);
  
  //     const round = await permissionManager.rounds(0);
  //     expect(round.systemPublicKey).to.not.equal(hre.ethers.constants.HashZero);
  //   });
  // });
});