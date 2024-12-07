// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "hardhat";

const ROUND_BLOCKS = 1000;
const ROUND_TIMEOUT = 12000;
const ZERO_POINT_ONE_ETHER = ethers.parseEther("0.01"); // 使用 ethers.js 工具将 0.01 转为 wei

const DeployModule = buildModule("DeployModule", (m) => {
  const _roundBlocks = m.getParameter("_roundBlocks", ROUND_BLOCKS);
  const _roundTimeout = m.getParameter("_roundTimeout", ROUND_TIMEOUT);
  const _zeroPointOneEther = m.getParameter("_zeroPointOneEther", ZERO_POINT_ONE_ETHER);

  const permissionManager = m.contract("PermissionManager", [_roundBlocks, _roundTimeout, _zeroPointOneEther], {
    
  });

  return { permissionManager };
});

export default DeployModule;
