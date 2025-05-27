import { expect } from "chai";
import hre from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { extendEnvironment } from "hardhat/config";
import { populate } from "dotenv";
  
describe("PermissionManagerV2", function () {
  async function deployPermissionManagerFixture() {
    const ROUND_BLOCKS = 1000;
    const ROUND_TIMEOUT = 1;
    const MIN_DEPOSIT = hre.ethers.parseEther("0.01");
    const MAX_VALIDATORS = 2;
    const [owner, node1, node2, node3, node4] = await hre.ethers.getSigners();
  
    const PermissionManager = await hre.ethers.getContractFactory("PermissionManagerV2");
    const permissionManager = await PermissionManager.deploy(ROUND_BLOCKS, ROUND_TIMEOUT, MIN_DEPOSIT, MAX_VALIDATORS);
  
    return { permissionManager, owner, node1, node2, node3, node4, ROUND_BLOCKS, ROUND_TIMEOUT, MIN_DEPOSIT };
  }

  async function deployPermissionManagerFixture2() {
    const ROUND_BLOCKS = 1000;
    const ROUND_TIMEOUT = 5;
    const MIN_DEPOSIT = hre.ethers.parseEther("0.01");
    const MAX_VALIDATORS = 3;
    const [owner, node1, node2, node3, node4] = await hre.ethers.getSigners();
  
    const PermissionManager = await hre.ethers.getContractFactory("PermissionManagerV2");
    const permissionManager = await PermissionManager.deploy(ROUND_BLOCKS, ROUND_TIMEOUT, MIN_DEPOSIT, MAX_VALIDATORS);
  
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
    it("Should allow a node to propose election with sufficient deposit", async function () {
      const { permissionManager, node1, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
  
      await expect(permissionManager.connect(node1).proposeElection({ value: MIN_DEPOSIT }))
        .to.emit(permissionManager, "NodeElectionProposed")
        .withArgs(node1.address, 0);
  
      const nodeInfo = await permissionManager.nodes(node1.address);
      expect(nodeInfo.deposit).to.equal(MIN_DEPOSIT);
      const candidateNum = await permissionManager.connect(node1).getCandidatesNum();
      expect(candidateNum).to.equal(1);
      const candidate1 = await permissionManager.candidates(0);
      expect(candidate1).to.equal(node1.address);
    });
  
    it("Should not allow a node to propose join with insufficient deposit", async function () {
      const { permissionManager, node1 } = await loadFixture(deployPermissionManagerFixture);
      const deposit = hre.ethers.parseEther("0.005");
  
      await expect(permissionManager.connect(node1).proposeElection({ value: deposit }))
        .to.be.revertedWith("Deposit required");
    });
  
    it("Should allow nodes to stake to themselves and delegate to other nodes", async function () {
      const { permissionManager, node1, node2, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
      
      await expect(permissionManager.connect(node1).stake({ value: MIN_DEPOSIT }))
        .to.emit(permissionManager, "Staked")
        .withArgs(node1.address, MIN_DEPOSIT);

      const nodeInfo = await permissionManager.nodes(node1.address);
      expect(nodeInfo.selfStake).to.equal(MIN_DEPOSIT);
      expect(nodeInfo.totalStake).to.equal(MIN_DEPOSIT);
    });

    it("Should allow nodes to delegate to other nodes", async function () {
      const { permissionManager, node1, node2, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
      
      await expect(permissionManager.connect(node1).stake({ value: MIN_DEPOSIT }))
        .to.emit(permissionManager, "Staked")
        .withArgs(node1.address, MIN_DEPOSIT);

      await expect(permissionManager.connect(node2).delegate(node1.address, { value: MIN_DEPOSIT }))
        .to.emit(permissionManager, "Delegated")
        .withArgs(node2.address, node1.address, MIN_DEPOSIT);
      
      const nodeInfo2 = await permissionManager.nodes(node1.address);
      expect(nodeInfo2.selfStake).to.equal(MIN_DEPOSIT);
      expect(nodeInfo2.totalStake).to.equal(MIN_DEPOSIT * 2n);

      const delegations = await permissionManager.delegations(node1.address, 0);
      expect(delegations.delegator).to.equal(node2.address);
      expect(delegations.amount).to.equal(MIN_DEPOSIT);
      
    });

    it("Should allow nodes to revoke delegation", async function () {
      const { permissionManager, node1, node2, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
      
      const contractAddress = await permissionManager.getAddress();
      const contractInitialBalance = await hre.ethers.provider.getBalance(contractAddress);

      await permissionManager.connect(node2).delegate(node1.address, { value: MIN_DEPOSIT });

      const contractBalance1 = await hre.ethers.provider.getBalance(contractAddress);
      expect(contractBalance1 - contractInitialBalance).to.equal(MIN_DEPOSIT);
      
      await expect(permissionManager.connect(node2).revokeDelegation(node1.address, MIN_DEPOSIT))
        .to.emit(permissionManager, "RevokeDelegated")
        .withArgs(node2.address, node1.address, MIN_DEPOSIT);
      
      const nodeInfo1 = await permissionManager.nodes(node1.address);
      expect(nodeInfo1.totalStake).to.equal(0n);

      const contractBalance2 = await hre.ethers.provider.getBalance(contractAddress);
      expect(contractBalance1 - contractBalance2).to.equal(MIN_DEPOSIT);
    });
  
    it("Should elect correctly", async function () {
      const { permissionManager, owner, node1, node2, node3, node4, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);

      await permissionManager.connect(node1).proposeElection({ value: MIN_DEPOSIT });
      await permissionManager.connect(node2).proposeElection({ value: MIN_DEPOSIT });
      await permissionManager.connect(node3).proposeElection({ value: MIN_DEPOSIT });
      await permissionManager.connect(node4).proposeElection({ value: MIN_DEPOSIT });

      await permissionManager.connect(node1).stake({ value: MIN_DEPOSIT * 3n });
      await permissionManager.connect(node2).stake({ value: MIN_DEPOSIT * 2n });
      await permissionManager.connect(node3).stake({ value: MIN_DEPOSIT });

      const candidatesNum = await permissionManager.connect(owner).getCandidatesNum();
      expect(candidatesNum).to.equal(4);

      await permissionManager.connect(owner).startElection();

      const validatorsNum = await permissionManager.connect(owner).getValidatorsNum();
      expect(validatorsNum).to.equal(2);

      const validator1 = await permissionManager.connect(owner).validators(0);
      expect(validator1).to.equal(node1.address);
      const validator2 = await permissionManager.connect(owner).validators(1);
      expect(validator2).to.equal(node2.address);

      await permissionManager.connect(node4).delegate(node3.address, { value: MIN_DEPOSIT * 3n });

      await permissionManager.connect(owner).startElection();

      const validator11 = await permissionManager.connect(owner).validators(0);
      expect(validator11).to.equal(node3.address);

      const validator22 = await permissionManager.connect(owner).validators(1);
      expect(validator22).to.equal(node1.address);
    });

    it("Should allow nodes to leave", async function () {
      const { permissionManager, owner, node1, node2, node3, node4, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);

      await permissionManager.connect(node1).proposeElection({ value: MIN_DEPOSIT });
      await permissionManager.connect(node2).proposeElection({ value: MIN_DEPOSIT });
      await permissionManager.connect(node3).proposeElection({ value: MIN_DEPOSIT });

      await permissionManager.connect(node1).stake({ value: MIN_DEPOSIT * 3n });
      await permissionManager.connect(node2).stake({ value: MIN_DEPOSIT * 2n });
      await permissionManager.connect(node3).stake({ value: MIN_DEPOSIT });

      await permissionManager.connect(owner).startElection();

      await expect(permissionManager.connect(node1).proposeLeave())
        .to.emit(permissionManager, "NodeLeaveProposed")
        .withArgs(node1.address, 1);

      const balance = await hre.ethers.provider.getBalance(node1.address);

      await permissionManager.connect(owner).startElection();

      const balance2 = await hre.ethers.provider.getBalance(node1.address);
      expect(balance2 - balance).to.equal(MIN_DEPOSIT * 4n);

      const validator1 = await permissionManager.connect(owner).validators(0);
      expect(validator1).to.equal(node2.address);
      const validator2 = await permissionManager.connect(owner).validators(1);
      expect(validator2).to.equal(node3.address);

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
      
      await permissionManager.connect(node).proposeElection({ value: MIN_DEPOSIT });

      await permissionManager.connect(owner).startElection();

      const validatorsNum = await permissionManager.connect(owner).getValidatorsNum();
      expect(validatorsNum).to.equal(1);

      const validator1 = await permissionManager.connect(owner).validators(0);
      expect(validator1).to.equal(node.address);
  
      const message = hre.ethers.AbiCoder.defaultAbiCoder().encode(["address"], [node.address]);
      const hash = hre.ethers.keccak256(message);
      const signature = await node.signMessage(hre.ethers.getBytes(hash));

      // const [isVerified, err, errArg] = await permissionManager.connect(node).verifySignature(signature, node.address);
      // expect(isVerified).to.be.true;

      await permissionManager.connect(node).submitPubKey(pubKey, signature, 1);
  
      const nodePubKey = await permissionManager.getRoundPublicKey(1, node.address);
      expect(nodePubKey).to.equal(pubKey);
    });

    // it("Should reject invalid signature", async function () {
    //   const { permissionManager, owner, node1, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);

    //   await permissionManager.connect(node1).proposeElection({ value: MIN_DEPOSIT });

    //   await permissionManager.connect(owner).startElection();

    //   const pubKey = hre.ethers.hexlify(hre.ethers.randomBytes(32));
    //   const signature = hre.ethers.hexlify(hre.ethers.randomBytes(65));
    //   await expect(
    //     permissionManager.connect(node1).submitPubKey(pubKey, signature, 1)
    //   ).to.be.revertedWith("Invalid signature");
    // });
  
    it("Should not allow non-permissioned nodes to submit public keys", async function () {
      const { permissionManager, node1 } = await loadFixture(deployPermissionManagerFixture);
  
      const pubKey = hre.ethers.hexlify(hre.ethers.randomBytes(32));
      const signature = hre.ethers.hexlify(hre.ethers.randomBytes(65));
      await expect(
        permissionManager.connect(node1).submitPubKey(pubKey, signature, 0)
      ).to.be.revertedWith("Not a permissioned node");
    });
  
    it("Should not allow submitting public key for wrong round", async function () {
      const { permissionManager, owner, node1, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
  
      await permissionManager.connect(node1).proposeElection({ value: MIN_DEPOSIT });

      await permissionManager.connect(owner).startElection();
  
      const pubKey = hre.ethers.hexlify(hre.ethers.randomBytes(32));
      const signature = hre.ethers.hexlify(hre.ethers.randomBytes(65));
      await expect(
        permissionManager.connect(node1).submitPubKey(pubKey, signature, 0)
      ).to.be.revertedWith("Round mismatch");
    });
    
    it("Should not allow submitting public key twice in same round", async function () {
      const { permissionManager, owner, node1, node2, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture2);
      
      const node = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
      const uncompressedPubKey = hre.ethers.SigningKey.computePublicKey(node.privateKey,false);

      const pubKey = "0x" + uncompressedPubKey.slice(4,68);
      
      await owner.sendTransaction({
        to: node.address,
        value: hre.ethers.parseEther("0.1")
      });
      
      await permissionManager.connect(node).proposeElection({ value: MIN_DEPOSIT });
      await permissionManager.connect(node1).proposeElection({ value: MIN_DEPOSIT });
      await permissionManager.connect(node2).proposeElection({ value: MIN_DEPOSIT });

      await permissionManager.connect(owner).startElection();

  
      const message = hre.ethers.AbiCoder.defaultAbiCoder().encode(["address"], [node.address]);
      const hash = hre.ethers.keccak256(message);
      const signature = await node.signMessage(hre.ethers.getBytes(hash));

      await permissionManager.connect(node).submitPubKey(pubKey, signature, 1);

      await expect(permissionManager.connect(node).submitPubKey(pubKey, signature, 1)).to.be.revertedWith("Already submitted public key");

    });
  
    it("Should generate system public key when enough public keys are submitted", async function () {
      const { permissionManager, owner, node3, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture2);
      
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
      
      await permissionManager.connect(node1).proposeElection({ value: MIN_DEPOSIT });
      await permissionManager.connect(node2).proposeElection({ value: MIN_DEPOSIT });
      await permissionManager.connect(node3).proposeElection({ value: MIN_DEPOSIT });

      await permissionManager.connect(owner).startElection();
  
      const message = hre.ethers.AbiCoder.defaultAbiCoder().encode(["address"], [node1.address]);
      const hash = hre.ethers.keccak256(message);
      const signature = await node1.signMessage(hre.ethers.getBytes(hash));

      await permissionManager.connect(node1).submitPubKey(pubKey, signature, 1);

      const message2 = hre.ethers.AbiCoder.defaultAbiCoder().encode(["address"], [node2.address]);
      const hash2 = hre.ethers.keccak256(message2);
      const signature2 = await node2.signMessage(hre.ethers.getBytes(hash2));

      await expect(permissionManager.connect(node2).submitPubKey(pubKey2, signature2, 1)).to.emit(permissionManager, "SystemPublicKeyGenerated")
        .withArgs(1, [pubKey, pubKey2], [node1.address, node2.address]);
    });
  
    it("Should allow getting system public key for a round", async function () {
      const { permissionManager, owner, node3, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture2);
      
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
      
      await permissionManager.connect(node1).proposeElection({ value: MIN_DEPOSIT });
      await permissionManager.connect(node2).proposeElection({ value: MIN_DEPOSIT });
      await permissionManager.connect(node3).proposeElection({ value: MIN_DEPOSIT });

      await permissionManager.connect(owner).startElection();
  
      const message = hre.ethers.AbiCoder.defaultAbiCoder().encode(["address"], [node1.address]);
      const hash = hre.ethers.keccak256(message);
      const signature = await node1.signMessage(hre.ethers.getBytes(hash));

      await permissionManager.connect(node1).submitPubKey(pubKey, signature, 1);

      const message2 = hre.ethers.AbiCoder.defaultAbiCoder().encode(["address"], [node2.address]);
      const hash2 = hre.ethers.keccak256(message2);
      const signature2 = await node2.signMessage(hre.ethers.getBytes(hash2));

      await permissionManager.connect(node2).submitPubKey(pubKey2, signature2, 1);

      const [publicKeys, nodesList] = await permissionManager.connect(node1).getSystemPublicKey(1);
      expect(publicKeys).to.deep.equal([pubKey, pubKey2]);
      expect(nodesList).to.deep.equal([node1.address, node2.address]);
    });
  });

  describe("Private Key Management", function () {
    it("Should allow permissioned nodes to submit private keys", async function () {
      const { permissionManager, owner, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
      
      const node = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
      
      await owner.sendTransaction({
        to: node.address,
        value: hre.ethers.parseEther("0.1")
      });
      
      await permissionManager.connect(node).proposeElection({ value: MIN_DEPOSIT });

      await permissionManager.connect(owner).startElection();

      const validatorsNum = await permissionManager.connect(owner).getValidatorsNum();
      expect(validatorsNum).to.equal(1);

      const validator1 = await permissionManager.connect(owner).validators(0);
      expect(validator1).to.equal(node.address);

      await permissionManager.connect(node).submitPriKey(node.privateKey, 1);

      const nodePrivateKey = await permissionManager.connect(node).getRoundPrivateKey(1, node.address);
      expect(nodePrivateKey).to.equal(node.privateKey);
    });
  });

  describe("Proposal Management", function () {
    it("Should allow permissioned nodes to submit a proposal to edit historical block", async function () {
      const { permissionManager, owner, MIN_DEPOSIT } = await loadFixture(deployPermissionManagerFixture);
      
      const node = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
      
      await owner.sendTransaction({
        to: node.address,
        value: hre.ethers.parseEther("0.1")
      });
      
      await permissionManager.connect(node).proposeElection({ value: MIN_DEPOSIT });

      await permissionManager.connect(owner).startElection();
  
      await permissionManager.connect(node).submitProposal(1, "lwl owe hz a btc");

      const nextId = await permissionManager.connect(node).PROPOSAL_ID();
      expect(nextId).to.equal(1);
      
      const [proposer, blockNumber, description] = await permissionManager.connect(node).getProposalInfo(0);
      
      expect(proposer).to.equal(node.address);
      expect(blockNumber).to.equal(1);
      expect(description).to.equal("lwl owe hz a btc");
    });
  });
});