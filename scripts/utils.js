const BN = require('bn.js')

// These functions are meant to be run from tasks, so the
// hardhatRuntimeEnvironment is available in the global scope.

/**
 * Returns the deployed instance of the Mollusk DAO, or undefined if its
 * address hasn't been set in the config.
 */
async function getDeployedMollusk () {
  const molluskAddress = getMolluskAddress()
  if (!molluskAddress) {
    console.error(`Please, set the DAO's address in hardhat.config.js's networks.${hardhatArguments.network}.deployedContracts.mollusk`)
    return
  }

  const Mollusk = artifacts.require('Mollusk')
  return Mollusk.at(molluskAddress)
}

/**
 * Returns the deployed instance of the MolluskPool contract, or undefined if its
 * address hasn't been set in the config.
 */
async function getDeployedPool () {
  const poolAddress = getPoolAddress()
  if (!poolAddress) {
    console.error(`Please, set the Pool's address in hardhat.config.js's networks.${hardhatArguments.network}.deployedContracts.pool`)
    return
  }

  const Pool = artifacts.require('MolluskPool')
  return Pool.at(poolAddress)
}

/**
 * Returns the deployed instance of the Mollusk DAO's approved token, or
 * undefined if the DAO's address hasn't been set in the config.
 */
async function getApprovedToken () {
  const mollusk = await getDeployedMollusk()
  if (mollusk === undefined) {
    return
  }

  const IERC20 = artifacts.require('IERC20')
  const tokenAddress = await mollusk.approvedToken()

  return IERC20.at(tokenAddress)
}

/**
 * Returns the address of the Mollusk DAO as set in the config, or undefined if
 * it hasn't been set.
 */
function getMolluskAddress () {
  return config.networks[hardhatArguments.network].deployedContracts.mollusk
}

/**
 * Returns the address of the MolluskPool as set in the config, or undefined if
 * it hasn't been set.
 */
function getPoolAddress () {
  return config.networks[hardhatArguments.network].deployedContracts.pool
}

async function giveAllowance (tokenContract, allowanceGiver, receiverContract, amount) {
  return tokenContract.approve(receiverContract.address, amount, { from: allowanceGiver })
}

async function hasEnoughAllowance (tokenContract, allowanceGiver, receiverContract, amount) {
  const allowance = await tokenContract.allowance(allowanceGiver, receiverContract.address)
  return allowance.gte(new BN(amount))
}

async function hasEnoughTokens (tokenContract, tokensOwner, amount) {
  const balance = await tokenContract.balanceOf(tokensOwner)
  return balance.gte(new BN(amount))
}

async function getFirstAccount () {
  const accounts = await web3.eth.getAccounts()
  return accounts[0]
}

async function hasEnoughPoolShares (pool, owner, amount) {
  const shares = await pool.donors(owner);
  
  return shares.gte(new BN(amount));
}

module.exports = {
  getDeployedMollusk,
  getDeployedPool,
  getApprovedToken,
  getMolluskAddress,
  getPoolAddress,
  giveAllowance,
  hasEnoughAllowance,
  hasEnoughTokens,
  getFirstAccount,
  hasEnoughPoolShares
}
