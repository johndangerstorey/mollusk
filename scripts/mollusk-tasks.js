const BN = require('bn.js')
const deploymentParams = require('../deployment-params')

const {
  getDeployedMollusk,
  getFirstAccount,
  getApprovedToken,
  hasEnoughTokens,
  hasEnoughAllowance,
  giveAllowance
} = require('./utils')

task('mollusk-deploy', 'Deploys a new instance of the Mollusk DAO')
  .setAction(async () => {
    if (deploymentParams.SUMMONER === '' || deploymentParams.TOKEN === '') {
      console.error('Please set the deployment parameters in deployment-params.js')
      return
    }

    // Make sure everything is compiled
    await run('compile')

    console.log('Deploying a new DAO to the network ' + buidlerArguments.network)
    console.log(
      'Deployment parameters:\n',
      '  summoner:', deploymentParams.SUMMONER, '\n',
      '  token:', deploymentParams.TOKEN, '\n',
      '  periodSeconds:', deploymentParams.PERIOD_DURATION_IN_SECONDS, '\n',
      '  votingPeriods:', deploymentParams.VOTING_DURATON_IN_PERIODS, '\n',
      '  gracePeriods:', deploymentParams.GRACE_DURATON_IN_PERIODS, '\n',
      '  abortPeriods:', deploymentParams.ABORT_WINDOW_IN_PERIODS, '\n',
      '  proposalDeposit:', deploymentParams.PROPOSAL_DEPOSIT, '\n',
      '  dilutionBound:', deploymentParams.DILUTION_BOUND, '\n',
      '  processingReward:', deploymentParams.PROCESSING_REWARD, '\n'
    )

    const Confirm = require('prompt-confirm')
    const prompt = new Confirm('Please confirm that the deployment parameters are correct')
    const confirmation = await prompt.run()

    if (!confirmation) {
      return
    }

    const Mollusk = artifacts.require('Mollusk')

    console.log("Deploying...")
    const mollusk = await Mollusk.new(
      deploymentParams.SUMMONER,
      deploymentParams.TOKEN,
      deploymentParams.PERIOD_DURATION_IN_SECONDS,
      deploymentParams.VOTING_DURATON_IN_PERIODS,
      deploymentParams.GRACE_DURATON_IN_PERIODS,
      deploymentParams.ABORT_WINDOW_IN_PERIODS,
      deploymentParams.PROPOSAL_DEPOSIT,
      deploymentParams.DILUTION_BOUND,
      deploymentParams.PROCESSING_REWARD
    )

    console.log("")
    console.log('Mollusk DAO deployed. Address:', mollusk.address)
    console.log("Set this address in buidler.config.js's networks section to use the other tasks")
  })

task('mollusk-submit-proposal', 'Submits a proposal')
  .addParam('applicant', 'The address of the applicant')
  .addParam('tribute', "The number of token's wei offered as tribute")
  .addParam('shares', 'The number of shares requested')
  .addParam('details', "The proposal's details")
  .setAction(async ({ applicant, tribute, shares, details }) => {
    // Make sure everything is compiled
    await run('compile')

    const mollusk = await getDeployedMollusk()
    if (mollusk === undefined) {
      return
    }

    const token = await getApprovedToken()
    if (token === undefined) {
      return
    }

    const proposalDeposit = await mollusk.proposalDeposit()
    const sender = await getFirstAccount()

    if (!await hasEnoughTokens(token, sender, proposalDeposit)) {
      console.error("You don't have enough tokens to pay the deposit")
      return
    }

    if (!await hasEnoughAllowance(token, sender, mollusk, proposalDeposit)) {
      await giveAllowance(token, sender, mollusk, proposalDeposit)
    }

    if (new BN(tribute).gt(new BN(0))) {
      if (!await hasEnoughTokens(token, applicant, tribute)) {
        console.error("The applicant doesn't have enough tokens to pay the tribute")
        return
      }

      if (!await hasEnoughAllowance(token, applicant, mollusk, tribute)) {
        console.error('The applicant must give allowance to the DAO before being proposed')
        return
      }
    }

    const { receipt } = await mollusk.submitProposal(applicant, tribute, shares, details)
    const proposalIndex = receipt.logs[0].args.proposalIndex

    console.log('Submitted proposal number', proposalIndex.toString())
  })

task('mollusk-submit-vote', 'Submits a vote')
  .addParam('proposal', 'The proposal number', undefined, types.int)
  .addParam('vote', 'The vote (yes/no)')
  .setAction(async ({ proposal, vote }) => {
    // Make sure everything is compiled
    await run('compile')

    const mollusk = await getDeployedMollusk()
    if (mollusk === undefined) {
      return
    }

    if (vote.toLowerCase() !== 'yes' && vote.toLowerCase() !== 'no') {
      console.error('Invalid vote. It must be "yes" or "no".')
      return
    }

    const voteNumber = vote.toLowerCase() === 'yes' ? 1 : 2

    await mollusk.submitVote(proposal, voteNumber)
    console.log('Vote submitted')
  })

task('mollusk-process-proposal', 'Processes a proposal')
  .addParam('proposal', 'The proposal number', undefined, types.int)
  .setAction(async ({ proposal }) => {
    // Make sure everything is compiled
    await run('compile')

    const mollusk = await getDeployedMollusk()
    if (mollusk === undefined) {
      return
    }

    await mollusk.processProposal(proposal)
    console.log('Proposal processed')
  })

task('mollusk-ragequit', 'Ragequits, burning some shares and getting tokens back')
  .addParam('shares', 'The amount of shares to burn')
  .setAction(async ({ shares }) => {
    // Make sure everything is compiled
    await run('compile')

    const mollusk = await getDeployedMollusk()
    if (mollusk === undefined) {
      return
    }

    await mollusk.ragequit(shares)
    console.log(`Burn ${shares} shares`)
  })

task('mollusk-update-delegate', 'Updates your delegate')
  .addParam('delegate', "The new delegate's address")
  .setAction(async ({ delegate }) => {
    // Make sure everything is compiled
    await run('compile')

    const mollusk = await getDeployedMollusk()
    if (mollusk === undefined) {
      return
    }

    await mollusk.updateDelegateKey(delegate)
    console.log(`Delegate updated`)
  })
