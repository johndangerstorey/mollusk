const { artifacts, network, web3 } = require('hardhat')
const chai = require('chai')
const { assert } = chai

const BN = web3.utils.BN

const {
  verifyProposal,
  verifyFlags,
  verifyInternalBalance,
  verifyInternalBalances,
  verifyBalances,
  verifySubmitVote,
  verifyProcessProposal,
  verifyMember
} = require('./test-utils')

chai
  .use(require('chai-as-promised'))
  .should()

const Mollusk = artifacts.require('./Mollusk')
const Token = artifacts.require('./Token')

const revertMessages = {
  onlyDelegate: 'not a delegate',
  withdrawBalanceInsufficientBalance: 'insufficient balance',
  withdrawBalanceArrayLengthsMatch: 'tokens and amounts arrays must be matching lengths',
  submitWhitelistProposalMaximumNumberOfTokensReached: 'cannot submit more whitelist proposals',
  sponsorProposalMaximumNumberOfTokensReached: 'cannot sponsor more whitelist proposals',
  submitTributeProposalMaxGuildBankTokensReached: 'cannot submit more tribute proposals for new tokens - guildbank is full',
  sponsorTributeProposalMaxGuildBankTokensReached: 'cannot sponsor more tribute proposals for new tokens - guildbank is full',
  collectTokensMustBeWhitelisted: 'token to collect must be whitelisted',
  collectTokensMustHaveBalance: 'token to collect must have non-zero guild bank balance'
}

const SolRevert = 'VM Exception while processing transaction: revert'

const zeroAddress = '0x0000000000000000000000000000000000000000'
const GUILD  = '0x000000000000000000000000000000000000dead'
const ESCROW = '0x000000000000000000000000000000000000beef'
const MAX_TOKEN_WHITELIST_COUNT = new BN('10')
const MAX_TOKEN_GUILDBANK_COUNT = new BN('5') 

const _1 = new BN('1')
const _1e18 = new BN('1000000000000000000') // 1e18

const _10e18 = new BN('10000000000000000000') // 10e18
const _100e18 = new BN('100000000000000000000') // 10e18

async function blockTime () {
  const block = await web3.eth.getBlock('latest')
  return block.timestamp
}

async function snapshot () {
  return network.provider.send('evm_snapshot', [])
}

async function restore (snapshotId) {
  return network.provider.send('evm_revert', [snapshotId])
}

async function forceMine () {
  return network.provider.send('evm_mine', [])
}

const deploymentConfig = {
  'PERIOD_DURATION_IN_SECONDS': 17280,
  'VOTING_DURATON_IN_PERIODS': 35,
  'GRACE_DURATON_IN_PERIODS': 35,
  'PROPOSAL_DEPOSIT': 10,
  'DILUTION_BOUND': 3,
  'PROCESSING_REWARD': 1,
  'TOKEN_SUPPLY': _100e18
}

async function moveForwardPeriods (periods) {
  await blockTime()
  const goToTime = deploymentConfig.PERIOD_DURATION_IN_SECONDS * periods
  await network.provider.send('evm_increaseTime', [goToTime])
  await forceMine()
  await blockTime()
  return true
}

function addressArray(length) {
  // returns an array of distinct non-zero addresses
  let array = []
  for (let i = 1; i <= length; i++) {
    array.push('0x' + (new BN(i)).toString(16, 40))
  }
  return array
}

contract('Mollusk', ([creator, summoner, applicant1, applicant2, processor, delegateKey, nonMemberAccount, ...otherAccounts]) => {
  let mollusk, tokenAlpha, tokenBeta, tokenGamma, tokenDelta, tokenEpsilon, tokenCount
  let proposal1, proposal2, proposal3, depositToken

  const firstProposalIndex = 0
  const secondProposalIndex = 1
  const thirdProposalIndex = 2
  const invalidPropsalIndex = 123

  const yes = 1
  const no = 2

  const standardShareRequest = 1
  const standardLootRequest = 10
  const standardTribute = _1e18
  const summonerShares = 1

  let snapshotId

  const fundAndApproveToMollusk = async ({ token, to, from, value }) => {
    await token.transfer(to, value, { from: from })
    await token.approve(mollusk.address, value, { from: to })
  }

  before('deploy contracts', async () => {
    tokenAlpha = await Token.new(deploymentConfig.TOKEN_SUPPLY, { from: creator })
    tokenBeta = await Token.new(deploymentConfig.TOKEN_SUPPLY, { from: creator })
    tokenGamma = await Token.new(deploymentConfig.TOKEN_SUPPLY, { from: creator })
    tokenDelta = await Token.new(deploymentConfig.TOKEN_SUPPLY, { from: creator })
    tokenEpsilon = await Token.new(deploymentConfig.TOKEN_SUPPLY, { from: creator })

    mollusk = await Mollusk.new(
      summoner,
      [tokenAlpha.address, tokenBeta.address],
      deploymentConfig.PERIOD_DURATION_IN_SECONDS,
      deploymentConfig.VOTING_DURATON_IN_PERIODS,
      deploymentConfig.GRACE_DURATON_IN_PERIODS,
      deploymentConfig.PROPOSAL_DEPOSIT,
      deploymentConfig.DILUTION_BOUND,
      deploymentConfig.PROCESSING_REWARD
    )

    const depositTokenAddress = await mollusk.depositToken()
    assert.equal(depositTokenAddress, tokenAlpha.address)

    depositToken = tokenAlpha
  })

  beforeEach(async () => {
    snapshotId = await snapshot()

    proposal1 = {
      applicant: applicant1,
      sharesRequested: standardShareRequest,
      lootRequested: standardLootRequest,
      tributeOffered: standardTribute,
      tributeToken: tokenAlpha.address,
      paymentRequested: 0,
      paymentToken: tokenAlpha.address,
      details: 'all hail mollusk ALPHA'
    }

    proposal2 = {
      applicant: applicant2,
      sharesRequested: standardShareRequest,
      lootRequested: standardLootRequest,
      tributeOffered: standardTribute,
      tributeToken: tokenBeta.address,
      paymentRequested: 0,
      paymentToken: tokenBeta.address,
      details: 'all hail mollusk BETA'
    }

    proposal3 = {
      applicant: applicant2,
      sharesRequested: 0,
      lootRequested: 0,
      tributeOffered: 0,
      tributeToken: tokenAlpha.address,
      paymentRequested: 10,
      paymentToken: tokenBeta.address,
      details: 'all hail mollusk ALPHA tribute BETA payment'
    }
  })

  afterEach(async () => {
    await restore(snapshotId)
  })

  describe('collectTokens', () => {
    let tokensToCollect = 100

    beforeEach(async () => {
      proposal1.tributeOffered = 69

      await fundAndApproveToMollusk({
        token: tokenAlpha,
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await fundAndApproveToMollusk({
        token: tokenAlpha,
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      await mollusk.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      const proposalData = await mollusk.proposals(firstProposalIndex)

      await verifyProposal({
        mollusk: mollusk,
        proposal: proposal1,
        proposalId: firstProposalIndex,
        proposer: proposal1.applicant,
        expectedProposalCount: 1,
        expectedProposalQueueLength: 0
      })

      await mollusk.sponsorProposal(firstProposalIndex, { from: summoner })
      await moveForwardPeriods(1)

      await mollusk.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await mollusk.processProposal(firstProposalIndex, { from: processor })

      await verifyInternalBalances({
        mollusk,
        token: tokenAlpha,
        userBalances: {
          [GUILD]: proposal1.tributeOffered,
          [ESCROW]: 0,
          [proposal1.applicant]: 0,
          [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD, // sponsor - deposit returned,
          [processor]: deploymentConfig.PROCESSING_REWARD
        }
      })
    })

    it('happy case - collect tokens', async () => {
      await tokenAlpha.transfer(mollusk.address, 100, { from: creator })

      const molluskTokenAlphaBalance = +(await tokenAlpha.balanceOf(mollusk.address))
      assert.equal(molluskTokenAlphaBalance, proposal1.tributeOffered + tokensToCollect + deploymentConfig.PROPOSAL_DEPOSIT)

      await mollusk.collectTokens(tokenAlpha.address, { from: summoner })

      await verifyInternalBalances({
        mollusk,
        token: tokenAlpha,
        userBalances: {
          [GUILD]: proposal1.tributeOffered + tokensToCollect,
          [ESCROW]: 0,
          [proposal1.applicant]: 0,
          [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD, // sponsor - deposit returned,
          [processor]: deploymentConfig.PROCESSING_REWARD
        }
      })
    })

    it('require fail - must be member to collect', async () => {
      await tokenAlpha.transfer(mollusk.address, 100, { from: creator })

      const molluskTokenAlphaBalance = +(await tokenAlpha.balanceOf(mollusk.address))
      assert.equal(molluskTokenAlphaBalance, proposal1.tributeOffered + tokensToCollect + deploymentConfig.PROPOSAL_DEPOSIT)

      await mollusk.collectTokens(tokenAlpha.address, { from: proposal2.applicant }) // attempt to collect from non-member
        .should.be.rejectedWith(revertMessages.onlyDelegate)

      await verifyInternalBalances({
        mollusk,
        token: tokenAlpha,
        userBalances: {
          [GUILD]: proposal1.tributeOffered, // tokens to collect does not show up
          [ESCROW]: 0,
          [proposal1.applicant]: 0,
          [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD, // sponsor - deposit returned,
          [processor]: deploymentConfig.PROCESSING_REWARD
        }
      })
    })

    it('require fail - token to collect not whitelisted', async () => {
      // attempt to collect tokenGamma (not whitelisted))
      
      await tokenGamma.transfer(mollusk.address, 100, { from: creator })

      const molluskTokenGammaBalance = +(await tokenGamma.balanceOf(mollusk.address))
      assert.equal(molluskTokenGammaBalance, tokensToCollect)

      await mollusk.collectTokens(tokenGamma.address, { from: summoner })
        .should.be.rejectedWith(revertMessages.collectTokensMustBeWhitelisted)

      await verifyInternalBalances({
        mollusk,
        token: tokenBeta,
        userBalances: {
          [GUILD]: 0,
          [ESCROW]: 0,
          [proposal1.applicant]: 0,
          [summoner]: 0,
          [processor]: 0
        }
      })
    })

    it('require fail - guild bank balance for token to collect is zero', async () => {
      // attempt to collect tokenBeta (whitelisted but no balance)
      
      await tokenBeta.transfer(mollusk.address, 100, { from: creator })

      const molluskTokenBetaBalance = +(await tokenBeta.balanceOf(mollusk.address))
      assert.equal(molluskTokenBetaBalance, tokensToCollect)

      await mollusk.collectTokens(tokenBeta.address, { from: summoner })
        .should.be.rejectedWith(revertMessages.collectTokensMustHaveBalance)

      await verifyInternalBalances({
        mollusk,
        token: tokenBeta,
        userBalances: {
          [GUILD]: 0,
          [ESCROW]: 0,
          [proposal1.applicant]: 0,
          [summoner]: 0,
          [processor]: 0
        }
      })
    })
  })

  describe('multi-token ragequit + withdraw', async () => {
    beforeEach(async () => {
      // 1st proposal for with token alpha tribute
      await fundAndApproveToMollusk({
        token: tokenAlpha,
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      await mollusk.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      await fundAndApproveToMollusk({
        token: tokenAlpha,
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await mollusk.sponsorProposal(firstProposalIndex, { from: summoner })

      await moveForwardPeriods(1)
      await mollusk.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await mollusk.processProposal(firstProposalIndex, { from: processor })

      await verifyBalances({
        token: depositToken,
        mollusk: mollusk.address,
        expectedMolluskBalance: proposal1.tributeOffered.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT)), // tribute now in bank,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0
      })

      await verifyInternalBalances({
        mollusk,
        token: depositToken,
        userBalances: {
          [GUILD]: proposal1.tributeOffered,
          [ESCROW]: 0,
          [proposal1.applicant]: 0,
          [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD, // sponsor - deposit returned,
          [processor]: deploymentConfig.PROCESSING_REWARD
        }
      })

      await verifyMember({
        mollusk: mollusk,
        member: proposal1.applicant,
        expectedDelegateKey: proposal1.applicant,
        expectedShares: proposal1.sharesRequested,
        expectedLoot: proposal1.lootRequested,
        expectedMemberAddressByDelegateKey: proposal1.applicant
      })

      // 2nd proposal for with token beta tribute
      await fundAndApproveToMollusk({
        token: tokenBeta,
        to: proposal2.applicant,
        from: creator,
        value: proposal2.tributeOffered
      })

      await mollusk.submitProposal(
        proposal2.applicant,
        proposal2.sharesRequested,
        proposal2.lootRequested,
        proposal2.tributeOffered,
        proposal2.tributeToken,
        proposal2.paymentRequested,
        proposal2.paymentToken,
        proposal2.details,
        { from: proposal2.applicant }
      )

      await fundAndApproveToMollusk({
        token: depositToken,
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await mollusk.sponsorProposal(secondProposalIndex, { from: summoner })

      await moveForwardPeriods(1)
      await mollusk.submitVote(secondProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await mollusk.processProposal(secondProposalIndex, { from: processor })

      await verifyBalances({
        token: tokenBeta,
        mollusk: mollusk.address,
        expectedMolluskBalance: proposal2.tributeOffered,
        applicant: proposal2.applicant,
        expectedApplicantBalance: 0
      })

      await verifyInternalBalances({
        mollusk,
        token: tokenBeta,
        userBalances: {
          [GUILD]: proposal2.tributeOffered,
          [ESCROW]: 0,
          [proposal1.applicant]: 0,
          [summoner]: 0,
          [processor]: 0
        }
      })

      // check sponsor in deposit token returned
      await verifyBalances({
        token: depositToken,
        mollusk: mollusk.address,
        expectedMolluskBalance: proposal1.tributeOffered.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT * 2)), // tribute now in bank,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0
      })

      await verifyInternalBalances({
        mollusk,
        token: depositToken,
        userBalances: {
          [GUILD]: proposal1.tributeOffered,
          [ESCROW]: 0,
          [proposal1.applicant]: 0,
          [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2,
          [processor]: deploymentConfig.PROCESSING_REWARD * 2
        }
      })

      await verifyMember({
        mollusk: mollusk,
        member: proposal2.applicant,
        expectedDelegateKey: proposal2.applicant,
        expectedShares: proposal2.sharesRequested,
        expectedLoot: proposal2.lootRequested,
        expectedMemberAddressByDelegateKey: proposal2.applicant
      })
    })

    describe('happy path - ', () => {
      const sharesToQuit = new BN('1') // all
      let initialShares
      let initialLoot

      beforeEach(async () => {
        initialShares = await mollusk.totalShares()
        initialLoot = await mollusk.totalLoot()
        await mollusk.ragequit(sharesToQuit, 0, { from: proposal1.applicant })
      })

      it('member shares reduced', async () => {
        await verifyMember({
          mollusk: mollusk,
          member: proposal1.applicant,
          expectedDelegateKey: proposal1.applicant,
          expectedShares: proposal1.sharesRequested - sharesToQuit,
          expectedLoot: proposal1.lootRequested,
          expectedMemberAddressByDelegateKey: proposal1.applicant
        })

        // started with 3 total shares - rage quitted 1 - so now 2
        const totalShares = await mollusk.totalShares()
        assert.equal(+totalShares, summonerShares + proposal1.sharesRequested + proposal2.sharesRequested - sharesToQuit)

        // balances should be calculated correctly regardless of shares/loot requested in proposals 1-2
        await verifyBalances({
          token: depositToken,
          mollusk: mollusk.address,
          expectedMolluskBalance: proposal1.tributeOffered.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT * 2)),
          applicant: proposal1.applicant,
          expectedApplicantBalance: 0
        })

        await verifyInternalBalances({
          mollusk,
          token: depositToken,
          userBalances: {
            [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
            [ESCROW]: 0,
            [proposal1.applicant]: _1e18.mul(sharesToQuit).div(initialShares.add(initialLoot)),
            [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2,
            [processor]: deploymentConfig.PROCESSING_REWARD * 2
          }
        })

        await verifyBalances({
          token: tokenBeta,
          mollusk: mollusk.address,
          expectedMolluskBalance: proposal2.tributeOffered,
          applicant: proposal1.applicant,
          expectedApplicantBalance: 0
        })

        await verifyInternalBalances({
          mollusk,
          token: tokenBeta,
          userBalances: {
            [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
            [ESCROW]: 0,
            [proposal1.applicant]: _1e18.mul(sharesToQuit).div(initialShares.add(initialLoot)),
            [summoner]: 0,
            [processor]: 0
          }
        })
      })

      describe('withdraw balances', () => {
        let tokens, applicantTokenBalances
        let zeroesArray = [0, 0]

        beforeEach(async () => {
          tokens = [depositToken.address, tokenBeta.address]
          applicantTokenBalances = [_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot)), _1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))]
        })

        it('set max = true', async () => {
          await mollusk.withdrawBalances(tokens, zeroesArray, true, { from: proposal1.applicant })

          await verifyBalances({
            token: depositToken,
            mollusk: mollusk.address,
            expectedMolluskBalance: proposal1.tributeOffered.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT * 2)).sub(applicantTokenBalances[0]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: applicantTokenBalances[0]
          })

          await verifyInternalBalances({
            mollusk,
            token: depositToken,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 0, // full withdraw
              [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2,
              [processor]: deploymentConfig.PROCESSING_REWARD * 2
            }
          })

          await verifyBalances({
            token: tokenBeta,
            mollusk: mollusk.address,
            expectedMolluskBalance: proposal2.tributeOffered.sub(applicantTokenBalances[1]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: applicantTokenBalances[1]
          })

          await verifyInternalBalances({
            mollusk,
            token: tokenBeta,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 0, // full withdraw
              [summoner]: 0,
              [processor]: 0
            }
          })
        })

        it('full withdrawal (without max)', async () => {
          await mollusk.withdrawBalances(tokens, applicantTokenBalances, false, { from: proposal1.applicant })

          await verifyBalances({
            token: depositToken,
            mollusk: mollusk.address,
            expectedMolluskBalance: proposal1.tributeOffered.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT * 2)).sub(applicantTokenBalances[0]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: applicantTokenBalances[0]
          })

          await verifyInternalBalances({
            mollusk,
            token: depositToken,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 0, // full withdraw
              [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2,
              [processor]: deploymentConfig.PROCESSING_REWARD * 2
            }
          })

          await verifyBalances({
            token: tokenBeta,
            mollusk: mollusk.address,
            expectedMolluskBalance: proposal2.tributeOffered.sub(applicantTokenBalances[1]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: applicantTokenBalances[1]
          })

          await verifyInternalBalances({
            mollusk,
            token: tokenBeta,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 0, // full withdraw
              [summoner]: 0,
              [processor]: 0
            }
          })
        })

        it('partial withdrawal', async () => {
          let withdrawAmounts = []
          withdrawAmounts[0] = applicantTokenBalances[0].sub(_1)
          withdrawAmounts[1] = applicantTokenBalances[1].sub(new BN(37))

          await mollusk.withdrawBalances(tokens, withdrawAmounts, false, { from: proposal1.applicant })

          await verifyBalances({
            token: depositToken,
            mollusk: mollusk.address,
            expectedMolluskBalance: proposal1.tributeOffered.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT * 2)).sub(withdrawAmounts[0]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: withdrawAmounts[0]
          })

          await verifyInternalBalances({
            mollusk,
            token: depositToken,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 1, // withdraw all but 1
              [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2,
              [processor]: deploymentConfig.PROCESSING_REWARD * 2
            }
          })

          await verifyBalances({
            token: tokenBeta,
            mollusk: mollusk.address,
            expectedMolluskBalance: proposal2.tributeOffered.sub(withdrawAmounts[1]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: withdrawAmounts[1]
          })

          await verifyInternalBalances({
            mollusk,
            token: tokenBeta,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 37, // withdraw all but 37
              [summoner]: 0,
              [processor]: 0
            }
          })
        })

        it('repeat token (zero balance 2nd time)', async () => {
          tokens.push(depositToken.address)
          applicantTokenBalances.push(0)

          await mollusk.withdrawBalances(tokens, applicantTokenBalances, false, { from: proposal1.applicant })

          await verifyBalances({
            token: depositToken,
            mollusk: mollusk.address,
            expectedMolluskBalance: proposal1.tributeOffered.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT * 2)).sub(applicantTokenBalances[0]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: applicantTokenBalances[0]
          })

          await verifyInternalBalances({
            mollusk,
            token: depositToken,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 0, // full withdraw
              [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2,
              [processor]: deploymentConfig.PROCESSING_REWARD * 2
            }
          })

          await verifyBalances({
            token: tokenBeta,
            mollusk: mollusk.address,
            expectedMolluskBalance: proposal2.tributeOffered.sub(applicantTokenBalances[1]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: applicantTokenBalances[1]
          })

          await verifyInternalBalances({
            mollusk,
            token: tokenBeta,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 0, // full withdraw
              [summoner]: 0,
              [processor]: 0
            }
          })
        })

        it('repeat token (some balance each time)', async () => {
          tokens.push(depositToken.address)
          withdrawAmounts = applicantTokenBalances.slice()
          withdrawAmounts[0] = withdrawAmounts[0].sub(new BN(10))
          withdrawAmounts[2] = 10

          await mollusk.withdrawBalances(tokens, withdrawAmounts, false, { from: proposal1.applicant })

          await verifyBalances({
            token: depositToken,
            mollusk: mollusk.address,
            expectedMolluskBalance: proposal1.tributeOffered.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT * 2)).sub(applicantTokenBalances[0]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: applicantTokenBalances[0]
          })

          await verifyInternalBalances({
            mollusk,
            token: depositToken,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 0, // full withdraw
              [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2,
              [processor]: deploymentConfig.PROCESSING_REWARD * 2
            }
          })

          await verifyBalances({
            token: tokenBeta,
            mollusk: mollusk.address,
            expectedMolluskBalance: proposal2.tributeOffered.sub(withdrawAmounts[1]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: withdrawAmounts[1]
          })

          await verifyInternalBalances({
            mollusk,
            token: tokenBeta,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 0, // full withdraw
              [summoner]: 0,
              [processor]: 0
            }
          })
        })

        it('require fail - insufficient balance (1st token)', async () => {
          applicantTokenBalances[0] = applicantTokenBalances[0].add(_1)
          await mollusk.withdrawBalances(tokens, applicantTokenBalances, false, { from: proposal1.applicant })
            .should.be.rejectedWith(revertMessages.withdrawBalanceInsufficientBalance)
        })

        it('require fail - insufficient balance (2nd token)', async () => {
          applicantTokenBalances[1] = applicantTokenBalances[1].add(_1)
          await mollusk.withdrawBalances(tokens, applicantTokenBalances, false, { from: proposal1.applicant })
            .should.be.rejectedWith(revertMessages.withdrawBalanceInsufficientBalance)
        })

        it('require fail - insufficient balance (repeat token)', async () => {
          tokens.push(depositToken.address)
          applicantTokenBalances[2] = _1
          await mollusk.withdrawBalances(tokens, applicantTokenBalances, false, { from: proposal1.applicant })
            .should.be.rejectedWith(revertMessages.withdrawBalanceInsufficientBalance)
        })

        it('require fail - token & amounts array lengths must match', async () => {
          tokens.push(depositToken.address)
          await mollusk.withdrawBalances(tokens, applicantTokenBalances, false, { from: proposal1.applicant })
            .should.be.rejectedWith(revertMessages.withdrawBalanceArrayLengthsMatch)
        })
      })
    })

    // TODO bring back token w/ transfer restriction setup and test
    // - withdraw balance "transfer failed"
  })

  describe('token count limit - deploy with maximum token count', async () => {
    let token_whitelist_limit = 10

    it('deploy with maximum token count', async () => {
      mollusk = await Mollusk.new(
        summoner,
        [tokenAlpha.address].concat(addressArray(token_whitelist_limit - 1)),
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      )

      tokenCount = await mollusk.getTokenCount()
      assert.equal(+tokenCount, +token_whitelist_limit)

      // check only first token
      const isWhitelisted = await mollusk.tokenWhitelist.call(tokenAlpha.address)
      assert.equal(isWhitelisted, true)
      const firstTokenAddress = await mollusk.approvedTokens(0)
      assert.equal(firstTokenAddress, tokenAlpha.address)
      const depositTokenAddress = await mollusk.depositToken()
      assert.equal(depositTokenAddress, tokenAlpha.address)
    })
  })

  describe('token count limit - add tokens during operation', async () => {
    beforeEach(async () => {
      // deploy with maximum - 1 tokens, so we can add 1 more
      mollusk = await Mollusk.new(
        summoner,
        [tokenAlpha.address].concat(addressArray(token_whitelist_limit - 2)),
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      )

      tokenCount = await mollusk.getTokenCount()
      assert.equal(+tokenCount, token_whitelist_limit - 1)

      // check only first token
      const alphaIsWhitelisted = await mollusk.tokenWhitelist.call(tokenAlpha.address)
      assert.equal(alphaIsWhitelisted, true)
      const firstTokenAddress = await mollusk.approvedTokens(0)
      assert.equal(firstTokenAddress, tokenAlpha.address)
      const depositTokenAddress = await mollusk.depositToken()
      assert.equal(depositTokenAddress, tokenAlpha.address)

      await fundAndApproveToMollusk({
        token: tokenAlpha,
        to: summoner,
        from: creator,
        value: 3 * deploymentConfig.PROPOSAL_DEPOSIT
      })

      await mollusk.submitWhitelistProposal( // first
        tokenBeta.address,
        'whitelist beta!',
        { from: summoner }
      )

      await mollusk.submitWhitelistProposal( // second
        tokenGamma.address,
        'whitelist gamma!',
        { from: summoner }
      )

      await mollusk.submitWhitelistProposal( // third
        tokenDelta.address,
        'whitelist delta!',
        { from: summoner }
      )

      await mollusk.sponsorProposal(firstProposalIndex, { from: summoner })
      await moveForwardPeriods(1)
      await mollusk.submitVote(firstProposalIndex, yes, { from: summoner })

      await mollusk.sponsorProposal(secondProposalIndex, { from: summoner })
      await moveForwardPeriods(1)
      await mollusk.submitVote(secondProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await mollusk.processWhitelistProposal(firstProposalIndex, { from: summoner })

      tokenCount = await mollusk.getTokenCount()
      assert.equal(+tokenCount, +token_whitelist_limit)

      const lastTokenAddress = await mollusk.approvedTokens(token_whitelist_limit - 1)
      assert.equal(lastTokenAddress, tokenBeta.address)
      const betaIsWhitelisted = await mollusk.tokenWhitelist.call(tokenBeta.address)
      assert.equal(betaIsWhitelisted, true)
    })

    it('proposal to add another token fails when maximum reached', async () => {
      await mollusk.processWhitelistProposal(secondProposalIndex, { from: summoner })

      await verifyProcessProposal({
        mollusk: mollusk,
        proposalIndex: secondProposalIndex,
        expectedYesVotes: summonerShares,
        expectedNoVotes: 0,
        expectedTotalShares: summonerShares,
        expectedMaxSharesAndLootAtYesVote: summonerShares
      })

      await verifyFlags({
        mollusk: mollusk,
        proposalId: secondProposalIndex,
        expectedFlags: [true, true, false, false, true, false] // failed
      })

      const gammaIsWhitelisted = await mollusk.tokenWhitelist.call(tokenGamma.address)
      assert.equal(gammaIsWhitelisted, false)
    })

    it('require fail - sponsor another whitelist proposal when maximum reached', async () => {
      await mollusk.sponsorProposal(
        thirdProposalIndex,
        { from: summoner }
      ).should.be.rejectedWith(revertMessages.sponsorProposalMaximumNumberOfTokensReached)
    })


    it('require fail - submit another whitelist proposal when maximum reached', async () => {
      await mollusk.submitWhitelistProposal(
        tokenEpsilon.address,
        'whitelist epsilon!',
        { from: summoner }
      ).should.be.rejectedWith(revertMessages.submitWhitelistProposalMaximumNumberOfTokensReached)
    })
  })

  describe('guild bank token limit', () => {
    let token_guildbank_limit = 10
    let tokens, tokenAddresses

    beforeEach(async () => {
      // 1. create max tokens
      // 2. whitelist max tokens
      // 3. add tribute in 1 less than max tokens
      tokens = [tokenAlpha]
      proposal1.tributeOffered = 69

      // mint max guildbank tokens, in addition to tokenAlpha this should provide us 1 extra whitelisted token to test the boundary
      for (let i=0; i < token_guildbank_limit; i++) {
        let token = await Token.new(deploymentConfig.TOKEN_SUPPLY, { from: creator })
        tokens.push(token)
      }

      tokenAddresses = tokens.map(t => t.address)

      // add tokens to whitelist in a new mollusk constructor so we can skip proposals for it
      mollusk = await Mollusk.new(
        summoner,
        tokenAddresses,
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      )

      let tokenCount = await mollusk.getTokenCount()
      assert.equal(+tokenCount, tokens.length)

      await fundAndApproveToMollusk({
        token: tokenAlpha,
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT * tokens.length
      })

      // add some tribute in each token EXCEPT the last TWO
      // this will leave us with 1 slot open and 1 extra so we can test submit/sponsor/process boundary conditions
      for (let i=0; i < tokens.length - 2; i++) {
        let token = tokens[i]

        await fundAndApproveToMollusk({
          token: token,
          to: proposal1.applicant,
          from: creator,
          value: proposal1.tributeOffered
        })

        await mollusk.submitProposal(
          proposal1.applicant,
          proposal1.sharesRequested,
          proposal1.lootRequested,
          proposal1.tributeOffered,
          token.address,
          proposal1.paymentRequested,
          proposal1.paymentToken,
          proposal1.details,
          { from: proposal1.applicant }
        )

        await verifyProposal({
          mollusk: mollusk,
          proposal: { ...proposal1, tributeToken: token.address },
          proposalId: i,
          proposer: proposal1.applicant,
          expectedProposalCount: i + 1,
          expectedProposalQueueLength: i
        })
  
        await mollusk.sponsorProposal(i, { from: summoner })
        await moveForwardPeriods(1)

        await mollusk.submitVote(i, yes, { from: summoner })
  
        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
        await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
  
        await mollusk.processProposal(i, { from: processor })
      }
    })

    it('submitting new tribute tokens after max is reached fails', async () => {
      const initialProposalCount = +(await mollusk.proposalCount());
      const initialProposalQueueLength = +(await mollusk.getProposalQueueLength());

      const totalGuildBankTokens = await mollusk.totalGuildBankTokens()
      assert(totalGuildBankTokens, token_guildbank_limit - 1)

      let token = tokens[tokens.length - 2]

      await fundAndApproveToMollusk({
        token: token,
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      await mollusk.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        token.address,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      await verifyProposal({
        mollusk: mollusk,
        proposal: { ...proposal1, tributeToken: token.address },
        proposalId: initialProposalCount,
        proposer: proposal1.applicant,
        expectedProposalCount: initialProposalCount + 1,
        expectedProposalQueueLength: initialProposalQueueLength
      })

      await mollusk.sponsorProposal(initialProposalCount, { from: summoner })
      await moveForwardPeriods(1)

      await mollusk.submitVote(initialProposalCount, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await mollusk.processProposal(initialProposalCount, { from: processor })

      const totalGuildBankTokensAfter = await mollusk.totalGuildBankTokens()
      assert(totalGuildBankTokensAfter, token_guildbank_limit)
      
      let extraToken = tokens[tokens.length - 1]
      await fundAndApproveToMollusk({
        token: extraToken,
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      // the next submit proposal fails bc the guild bank is full
      await mollusk.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        extraToken.address,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      ).should.be.rejectedWith(revertMessages.submitTributeProposalMaxGuildBankTokensReached)

      // however, reducing tribute to 0 will allow it to work
      await mollusk.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        0,
        extraToken.address,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      await verifyProposal({
        mollusk: mollusk,
        proposal: { ...proposal1, tributeToken: extraToken.address, tributeOffered: 0 },
        proposalId: initialProposalCount + 1,
        proposer: proposal1.applicant,
        expectedProposalCount: initialProposalCount + 2,
        expectedProposalQueueLength: initialProposalQueueLength + 1
      })
    })

    it('sponsoring a previously submitted tribute proposal fails after max guild bank tokens is reached', async () => {
      const initialProposalCount = +(await mollusk.proposalCount());
      const initialProposalQueueLength = +(await mollusk.getProposalQueueLength());

      const totalGuildBankTokens = await mollusk.totalGuildBankTokens()
      assert(totalGuildBankTokens, token_guildbank_limit - 1)

      // fund/approve/submit both tribute tokens
      let token1 = tokens[tokens.length - 2]
      let token2 = tokens[tokens.length - 1]

      await fundAndApproveToMollusk({
        token: token1,
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

            
      await fundAndApproveToMollusk({
        token: token2,
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      await mollusk.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        token1.address,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      await verifyProposal({
        mollusk: mollusk,
        proposal: { ...proposal1, tributeToken: token1.address },
        proposalId: initialProposalCount,
        proposer: proposal1.applicant,
        expectedProposalCount: initialProposalCount + 1,
        expectedProposalQueueLength: initialProposalQueueLength
      })

      await mollusk.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        token2.address,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      await verifyProposal({
        mollusk: mollusk,
        proposal: { ...proposal1, tributeToken: token2.address },
        proposalId: initialProposalCount + 1,
        proposer: proposal1.applicant,
        expectedProposalCount: initialProposalCount + 2,
        expectedProposalQueueLength: initialProposalQueueLength
      })

      await mollusk.sponsorProposal(initialProposalCount, { from: summoner })
      await moveForwardPeriods(1)

      await mollusk.submitVote(initialProposalCount, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await mollusk.processProposal(initialProposalCount, { from: processor })

      const totalGuildBankTokensAfter = await mollusk.totalGuildBankTokens()
      assert(totalGuildBankTokensAfter, token_guildbank_limit)
      
      await mollusk.sponsorProposal(initialProposalCount + 1, { from: summoner })
        .should.be.rejectedWith(revertMessages.sponsorTributeProposalMaxGuildBankTokensReached)
    })

    it('processing a previously sponsored tribute proposal fails after max guild bank tokens is reached', async () => {
      const initialProposalCount = +(await mollusk.proposalCount());
      const initialProposalQueueLength = +(await mollusk.getProposalQueueLength());

      const totalGuildBankTokens = await mollusk.totalGuildBankTokens()
      assert(totalGuildBankTokens, token_guildbank_limit - 1)

      // fund/approve/submit both tribute tokens
      let token1 = tokens[tokens.length - 2]
      let token2 = tokens[tokens.length - 1]

      await fundAndApproveToMollusk({
        token: token1,
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

            
      await fundAndApproveToMollusk({
        token: token2,
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      await mollusk.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        token1.address,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      await verifyProposal({
        mollusk: mollusk,
        proposal: { ...proposal1, tributeToken: token1.address },
        proposalId: initialProposalCount,
        proposer: proposal1.applicant,
        expectedProposalCount: initialProposalCount + 1,
        expectedProposalQueueLength: initialProposalQueueLength
      })

      await mollusk.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        token2.address,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      await verifyProposal({
        mollusk: mollusk,
        proposal: { ...proposal1, tributeToken: token2.address },
        proposalId: initialProposalCount + 1,
        proposer: proposal1.applicant,
        expectedProposalCount: initialProposalCount + 2,
        expectedProposalQueueLength: initialProposalQueueLength
      })

      // sponsor and vote YES on both proposals
      await mollusk.sponsorProposal(initialProposalCount, { from: summoner })
      await moveForwardPeriods(1)
      
      await mollusk.sponsorProposal(initialProposalCount + 1, { from: summoner })
      await moveForwardPeriods(1)

      await mollusk.submitVote(initialProposalCount, yes, { from: summoner })
      await mollusk.submitVote(initialProposalCount + 1, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await mollusk.processProposal(initialProposalCount, { from: processor })

      const totalGuildBankTokensAfter = await mollusk.totalGuildBankTokens()
      assert(totalGuildBankTokensAfter, token_guildbank_limit)

      // process the last tribute proposal after the guild bank limit is reached
      await mollusk.processProposal(initialProposalCount + 1, { from: processor })

      // the proposal should have simply failed
      await verifyFlags({
        mollusk: mollusk,
        proposalId: initialProposalCount + 1,
        expectedFlags: [true, true, false, false, false, false]
      })
    })
  })
  
  describe('RAGEQUIT AND WITHDRAW TOKENS AT MAXIMUM TOKEN LIMITS', () => {
    let tokens, tokenAddresses, guildbank_tokens, guildbank_token_addresses

    beforeEach(async function() {
      this.timeout(1200000)

      // 1. create max tokens
      // 2. whitelist max tokens
      // 3. add tribute in 1 less than max tokens
      tokens = [tokenAlpha]
      proposal1.tributeOffered = _1e18

      // mint max whitelist minus 1 (deposit token)
      for (let i=0; i < MAX_TOKEN_WHITELIST_COUNT - 1; i++) {
        let token = await Token.new(deploymentConfig.TOKEN_SUPPLY, { from: creator })
        tokens.push(token)
      }

      tokenAddresses = tokens.map(t => t.address)
      guildbank_tokens = tokens.slice(0, MAX_TOKEN_GUILDBANK_COUNT)
      guildbank_token_addresses = guildbank_tokens.map(t => t.address)

      // add tokens to whitelist in a new mollusk constructor so we can skip proposals for it
      mollusk = await Mollusk.new(
        summoner,
        [tokenAddresses[0]],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      )

      await fundAndApproveToMollusk({
        token: tokenAlpha,
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT * MAX_TOKEN_WHITELIST_COUNT
      })

      // whitelist all the tokens
      for (let i=1; i < tokens.length; i++) { // start at i=1, skip deposit token
        let token = tokens[i]

        await mollusk.submitWhitelistProposal(
          token.address,
          'whitelist this token!',
          { from: proposal1.applicant }
        )
  
        await mollusk.sponsorProposal(i - 1, { from: summoner })
        await moveForwardPeriods(1)

        await mollusk.submitVote(i - 1, yes, { from: summoner })
  
        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
        await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
  
        await mollusk.processWhitelistProposal(i - 1, { from: processor })
      }

      let tokenCount = +(await mollusk.getTokenCount())
      assert.equal(tokenCount, tokens.length)

      await fundAndApproveToMollusk({
        token: tokenAlpha,
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT * MAX_TOKEN_GUILDBANK_COUNT
      })

      // max out the tokens with a guild bank balance
      for (let i=0; i < MAX_TOKEN_GUILDBANK_COUNT; i++) {
        let token = tokens[i]

        await fundAndApproveToMollusk({
          token: token,
          to: proposal1.applicant,
          from: creator,
          value: proposal1.tributeOffered
        })

        await mollusk.submitProposal(
          proposal1.applicant,
          1, // only 1 share per proposal
          0,
          proposal1.tributeOffered,
          token.address,
          proposal1.paymentRequested,
          proposal1.paymentToken,
          proposal1.details,
          { from: proposal1.applicant }
        )
  
        await mollusk.sponsorProposal(i + tokenCount - 1, { from: summoner })
        await moveForwardPeriods(1)

        await mollusk.submitVote(i + tokenCount - 1, yes, { from: summoner })
  
        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
        await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
  
        await mollusk.processProposal(i + tokenCount - 1, { from: processor })

        await verifyInternalBalances({
          mollusk,
          token: token,
          userBalances: {
            [GUILD]: _1e18,
            [ESCROW]: 0,
            [proposal1.applicant]: 0
          }
        })
      }
    })

    it.only('can still ragequit and withdraw', async function() {
      this.timeout(1200000)

      const memberData = await mollusk.members(proposal1.applicant)

      let sharesToQuit = new BN(MAX_TOKEN_GUILDBANK_COUNT) // 1 share per guildbank token
      let initialShares = sharesToQuit.add(_1)
      await mollusk.ragequit(sharesToQuit, 0, { from: proposal1.applicant })

      await verifyMember({
        mollusk: mollusk,
        member: proposal1.applicant,
        expectedDelegateKey: proposal1.applicant,
        expectedShares: 0,
        expectedLoot: 0,
        expectedMemberAddressByDelegateKey: proposal1.applicant
      })

      await verifyInternalBalances({
        mollusk,
        token: depositToken,
        userBalances: {
          [GUILD]: _1e18.mul(_1).divRound(initialShares),
          [ESCROW]: 0,
          [proposal1.applicant]: _1e18.mul(sharesToQuit).divRound(initialShares),
          [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * +(MAX_TOKEN_GUILDBANK_COUNT.add(MAX_TOKEN_WHITELIST_COUNT).sub(_1).toString()),
          [processor]: deploymentConfig.PROCESSING_REWARD * +(MAX_TOKEN_GUILDBANK_COUNT.add(MAX_TOKEN_WHITELIST_COUNT).sub(_1).toString())
        }
      })

      for (let i=1; i < guildbank_tokens.length; i++) {
        await verifyInternalBalances({
          mollusk,
          token: guildbank_tokens[i],
          userBalances: {
            [GUILD]: _1e18.mul(_1).divRound(initialShares),
            [ESCROW]: 0,
            [proposal1.applicant]: _1e18.mul(sharesToQuit).divRound(initialShares)
          }
        })
      }
      
      let zeroesArray = guildbank_tokens.map(a => 0)
      await mollusk.withdrawBalances(guildbank_token_addresses, zeroesArray, true, { from: proposal1.applicant })

      await verifyInternalBalances({
        mollusk,
        token: depositToken,
        userBalances: {
          [GUILD]: _1e18.mul(_1).divRound(initialShares),
          [ESCROW]: 0,
          [proposal1.applicant]: 0,
          [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * +(MAX_TOKEN_GUILDBANK_COUNT.add(MAX_TOKEN_WHITELIST_COUNT).sub(_1).toString()),
          [processor]: deploymentConfig.PROCESSING_REWARD * +(MAX_TOKEN_GUILDBANK_COUNT.add(MAX_TOKEN_WHITELIST_COUNT).sub(_1).toString())
        }
      })

      for (let i=0; i < guildbank_tokens.length - 1; i++) {
        await verifyInternalBalances({
          mollusk,
          token: guildbank_tokens[i],
          userBalances: {
            [GUILD]: _1e18.mul(_1).divRound(initialShares),
            [ESCROW]: 0,
            [proposal1.applicant]: 0
          }
        })
      }
    })
  })
})
