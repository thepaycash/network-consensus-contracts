const fs = require('fs');
const Web3 = require('web3');
const EthereumUtil = require('ethereumjs-util');
const axios = require('axios');
const childProcess = require('child_process');
const constants = require('./utils/constants');

process.env.PROVIDER_URL = `https://kovan.infura.io/`;

const utils = require('./utils/utils');

const web3 = new Web3(new Web3.providers.HttpProvider(process.env.PROVIDER_URL));

require('chai')
	.use(require('chai-as-promised'))
	.use(require('chai-bignumber')(web3.BigNumber))
	.should();

main();

async function main() {
	try {
		const {privateKey, mocAddress} = await utils.readPrivateKey();

		process.env.PRIVATE_KEY = privateKey;
		process.env.MOC = EthereumUtil.toChecksumAddress(mocAddress);

		const key = Buffer.from(process.env.PRIVATE_KEY, 'hex');
		const sender = '0x' + EthereumUtil.privateToAddress(key).toString('hex');
		const chainId = web3.utils.toHex(await web3.eth.net.getId());

		console.log('PoaNetworkConsensus deployment...');
		const poaCompiled = await utils.compile('../../contracts/', 'PoaNetworkConsensus');
		process.env.POA_CONSENSUS_NEW_ADDRESS = await utils.deploy(
			'PoaNetworkConsensus', poaCompiled, sender, key, chainId, [process.env.MOC, []]
		);
		console.log(`  PoaNetworkConsensus address is ${process.env.POA_CONSENSUS_NEW_ADDRESS}`);
		const poaNewInstance = new web3.eth.Contract(poaCompiled.abi, process.env.POA_CONSENSUS_NEW_ADDRESS);

		console.log('  PoaNetworkConsensus checking...');
		for (let t = 0; t < 5; t++) {
			try {
				false.should.be.equal(
					await poaNewInstance.methods.finalized().call()
				);
				false.should.be.equal(
					await poaNewInstance.methods.wasProxyStorageSet().call()
				);
				false.should.be.equal(
					await poaNewInstance.methods.isMasterOfCeremonyRemoved().call()
				);
				false.should.be.equal(
					await poaNewInstance.methods.isMasterOfCeremonyRemovedPending().call()
				);
				process.env.MOC.toLowerCase().should.be.equal(
					(await poaNewInstance.methods.masterOfCeremony().call()).toLowerCase()
				);
				(await poaNewInstance.methods.masterOfCeremonyPending().call()).should.be.equal(
					'0x0000000000000000000000000000000000000000'
				);
				[process.env.MOC].should.be.deep.equal(
					await poaNewInstance.methods.getValidators().call()
				);
				[process.env.MOC].should.be.deep.equal(
					await poaNewInstance.methods.getPendingList().call()
				);
				(await poaNewInstance.methods.getCurrentValidatorsLength().call()).should.be.bignumber.equal(1);
				(await poaNewInstance.methods.getCurrentValidatorsLengthWithoutMoC().call()).should.be.bignumber.equal(0);
			} catch (check_err) {
				if (check_err.message.indexOf('Invalid JSON RPC response') >= 0) {
					console.log('  Invalid JSON RPC response. Another try in 5 seconds...');
					await utils.sleep(5000);
					continue;
				} else {
					throw check_err;
				}
			}
			break;
		}

		console.log('Success');
		console.log('');

		console.log('ProxyStorage deployment...');
		const proxyStorageCompiled = await utils.compile('../../contracts/', 'ProxyStorage');
		const proxyStorageImplAddress = await utils.deploy('ProxyStorage', proxyStorageCompiled, sender, key, chainId);
		console.log(`  ProxyStorage implementation address is ${proxyStorageImplAddress}`);
		let storageCompiled = await utils.compile('../../contracts/eternal-storage/', 'EternalStorageProxy');
		process.env.PROXY_STORAGE_NEW_ADDRESS = await utils.deploy('EternalStorageProxy', storageCompiled, sender, key, chainId, ['0x0000000000000000000000000000000000000000', proxyStorageImplAddress]);
		console.log(`  ProxyStorage storage address is ${process.env.PROXY_STORAGE_NEW_ADDRESS}`);
		const proxyStorageInstance = new web3.eth.Contract(proxyStorageCompiled.abi, process.env.PROXY_STORAGE_NEW_ADDRESS);
		let init = proxyStorageInstance.methods.init(process.env.POA_CONSENSUS_NEW_ADDRESS);
		await utils.call(init, sender, process.env.PROXY_STORAGE_NEW_ADDRESS, key, chainId);
		const setProxyStorage = poaNewInstance.methods.setProxyStorage(process.env.PROXY_STORAGE_NEW_ADDRESS);
		await utils.call(setProxyStorage, sender, process.env.POA_CONSENSUS_NEW_ADDRESS, key, chainId);
		
		console.log('  ProxyStorage checking...');
		true.should.be.equal(
			await proxyStorageInstance.methods.initDisabled().call()
		);
		false.should.be.equal(
			await proxyStorageInstance.methods.mocInitialized().call()
		);
		(await proxyStorageInstance.methods.getKeysManager().call()).should.be.equal(
			'0x0000000000000000000000000000000000000000'
		);
		(await proxyStorageInstance.methods.getVotingToChangeKeys().call()).should.be.equal(
			'0x0000000000000000000000000000000000000000'
		);
		(await proxyStorageInstance.methods.getVotingToChangeMinThreshold().call()).should.be.equal(
			'0x0000000000000000000000000000000000000000'
		);
		(await proxyStorageInstance.methods.getVotingToChangeProxy().call()).should.be.equal(
			'0x0000000000000000000000000000000000000000'
		);
		(await proxyStorageInstance.methods.getVotingToManageEmissionFunds().call()).should.be.equal(
			'0x0000000000000000000000000000000000000000'
		);
		process.env.POA_CONSENSUS_NEW_ADDRESS.should.be.equal(
			await proxyStorageInstance.methods.getPoaConsensus().call()
		);
		(await proxyStorageInstance.methods.getBallotsStorage().call()).should.be.equal(
			'0x0000000000000000000000000000000000000000'
		);
		(await proxyStorageInstance.methods.getValidatorMetadata().call()).should.be.equal(
			'0x0000000000000000000000000000000000000000'
		);
		(await proxyStorageInstance.methods.getRewardByBlock().call()).should.be.equal(
			'0x0000000000000000000000000000000000000000'
		);
		true.should.be.equal(
			await poaNewInstance.methods.wasProxyStorageSet().call()
		);
		process.env.PROXY_STORAGE_NEW_ADDRESS.should.be.equal(
			await poaNewInstance.methods.proxyStorage().call()
		);

		console.log('Success');
		console.log('');

		const {
			keysManagerNewAddress,
			keysManagerNewAbi
		} = await runExternalScript('./deployKeys.js');

		process.env.KEYS_MANAGER_NEW_ADDRESS = keysManagerNewAddress;
		process.env.KEYS_MANAGER_NEW_ABI = JSON.stringify(keysManagerNewAbi);

		const {
			ballotsStorageNewAddress,
			ballotsStorageNewAbi,
			votingToChangeKeysNewAddress,
			votingToChangeKeysNewAbi,
			votingToChangeMinThresholdNewAddress,
			votingToChangeMinThresholdNewAbi,
			votingToChangeProxyNewAddress,
			votingToChangeProxyNewAbi
		} = await runExternalScript('./deployVotings.js');

		console.log('Deploy ValidatorMetadata...');
		const metadataCompiled = await utils.compile('../../contracts/', 'ValidatorMetadata');
		const metadataImplAddress = await utils.deploy('ValidatorMetadata', metadataCompiled, sender, key, chainId);
		console.log('  ValidatorMetadata implementation address is ' + metadataImplAddress);
		storageCompiled = await utils.compile('../../contracts/eternal-storage/', 'EternalStorageProxy');
		process.env.METADATA_NEW_ADDRESS = await utils.deploy(
			'EternalStorageProxy', storageCompiled, sender, key, chainId, [process.env.PROXY_STORAGE_NEW_ADDRESS, metadataImplAddress]
		);
		console.log(`  ValidatorMetadata storage address is ${process.env.METADATA_NEW_ADDRESS}`);
		console.log('Success');
		console.log('');

		console.log('Deploy VotingToManageEmissionFunds...');
		const votingToManageEmissionFundsCompiled = await utils.compile('../../contracts/', 'VotingToManageEmissionFunds');
		const votingToManageEmissionFundsImplAddress = await utils.deploy('VotingToManageEmissionFunds', votingToManageEmissionFundsCompiled, sender, key, chainId);
		console.log('  VotingToManageEmissionFunds implementation address is ' + votingToManageEmissionFundsImplAddress);
		storageCompiled = await utils.compile('../../contracts/eternal-storage/', 'EternalStorageProxy');
		const votingToManageEmissionFundsAddress = await utils.deploy(
			'EternalStorageProxy', storageCompiled, sender, key, chainId, [process.env.PROXY_STORAGE_NEW_ADDRESS, votingToManageEmissionFundsImplAddress]
		);
		console.log(`  VotingToManageEmissionFunds storage address is ${votingToManageEmissionFundsAddress}`);
		const votingToManageEmissionFundsInstance = new web3.eth.Contract(votingToManageEmissionFundsCompiled.abi, votingToManageEmissionFundsAddress);
		console.log('Success');
		console.log('');

		console.log('Deploy EmissionFunds...');
		const emissionFundsCompiled = await utils.compile('../../contracts/', 'EmissionFunds');
		let emissionFundsAddress = await utils.deploy(
			'EmissionFunds', emissionFundsCompiled, sender, key, chainId, [votingToManageEmissionFundsAddress]
		);
		emissionFundsAddress = EthereumUtil.toChecksumAddress(emissionFundsAddress);
		console.log(`  EmissionFunds address is ${emissionFundsAddress}`);
		const emissionFundsInstance = new web3.eth.Contract(emissionFundsCompiled.abi, emissionFundsAddress);
		console.log('Success');
		console.log('');

		console.log('Deploy RewardByBlock...');
		let rewardByBlockCode = fs.readFileSync('../../contracts/RewardByBlock.sol').toString();
		rewardByBlockCode = rewardByBlockCode.replace('emissionFunds = 0x0000000000000000000000000000000000000000', 'emissionFunds = ' + emissionFundsAddress);
		const rewardByBlockCompiled = await utils.compile('../../contracts/', 'RewardByBlock', rewardByBlockCode);
		const rewardByBlockImplAddress = await utils.deploy('RewardByBlock', rewardByBlockCompiled, sender, key, chainId);
		console.log('  RewardByBlock implementation address is ' + rewardByBlockImplAddress);
		storageCompiled = await utils.compile('../../contracts/eternal-storage/', 'EternalStorageProxy');
		const rewardByBlockAddress = await utils.deploy(
			'EternalStorageProxy', storageCompiled, sender, key, chainId, [process.env.PROXY_STORAGE_NEW_ADDRESS, rewardByBlockImplAddress]
		);
		console.log(`  RewardByBlock storage address is ${rewardByBlockAddress}`);
		const rewardByBlockInstance = new web3.eth.Contract(rewardByBlockCompiled.abi, rewardByBlockAddress);
		console.log('Success');
		console.log('');

		console.log('VotingToManageEmissionFunds.init...');
		const distributionThreshold = 604800; // seven days, in seconds
		const emissionReleaseThreshold = 7776000; // three months, in seconds
		const emissionReleaseTime = 1577836800; // 01-Jan-2020 00:00:00 UTC (unix timestamp)
		init = votingToManageEmissionFundsInstance.methods.init(
			emissionReleaseTime,
			emissionReleaseThreshold,
			distributionThreshold,
			emissionFundsAddress
		);
		await utils.call(init, sender, votingToManageEmissionFundsAddress, key, chainId);
		emissionFundsAddress.should.be.equal(
			EthereumUtil.toChecksumAddress(await votingToManageEmissionFundsInstance.methods.emissionFunds().call())
		);
		emissionReleaseTime.should.be.equal(
			Number(await votingToManageEmissionFundsInstance.methods.emissionReleaseTime().call())
		);
		emissionReleaseThreshold.should.be.equal(
			Number(await votingToManageEmissionFundsInstance.methods.emissionReleaseThreshold().call())
		);
		distributionThreshold.should.be.equal(
			Number(await votingToManageEmissionFundsInstance.methods.distributionThreshold().call())
		);
		true.should.be.equal(
			await votingToManageEmissionFundsInstance.methods.initDisabled().call()
		);
		true.should.be.equal(
			await votingToManageEmissionFundsInstance.methods.noActiveBallotExists().call()
		);
		(await votingToManageEmissionFundsInstance.methods.nextBallotId().call()).should.be.bignumber.equal(0);
		EthereumUtil.toChecksumAddress(votingToManageEmissionFundsAddress).should.be.equal(
			EthereumUtil.toChecksumAddress(await emissionFundsInstance.methods.votingToManageEmissionFunds().call())
		);
		web3.utils.toWei('1', 'ether').should.be.equal(
			await rewardByBlockInstance.methods.blockRewardAmount().call()
		);
		web3.utils.toWei('1', 'ether').should.be.equal(
			await rewardByBlockInstance.methods.emissionFundsAmount().call()
		);
		emissionFundsAddress.should.be.equal(
			EthereumUtil.toChecksumAddress(await rewardByBlockInstance.methods.emissionFunds().call())
		);
		(await rewardByBlockInstance.methods.bridgesAllowed().call()).should.be.deep.equal([
			'0x0000000000000000000000000000000000000000',
			'0x0000000000000000000000000000000000000000',
			'0x0000000000000000000000000000000000000000'
		]);
		process.env.PROXY_STORAGE_NEW_ADDRESS.should.be.equal(
			await rewardByBlockInstance.methods.proxyStorage().call()
		);
		(await rewardByBlockInstance.methods.extraReceiversLength().call()).should.be.bignumber.equal(0);
		console.log('Success');
		console.log('');

		console.log('ProxyStorage.initializeAddresses...');
		const initializeAddresses = proxyStorageInstance.methods.initializeAddresses(
			keysManagerNewAddress,
			votingToChangeKeysNewAddress,
			votingToChangeMinThresholdNewAddress,
			votingToChangeProxyNewAddress,
			votingToManageEmissionFundsAddress,
			ballotsStorageNewAddress,
			process.env.METADATA_NEW_ADDRESS,
			rewardByBlockAddress
		);
		await utils.call(initializeAddresses, sender, process.env.PROXY_STORAGE_NEW_ADDRESS, key, chainId);
		true.should.be.equal(
			await proxyStorageInstance.methods.mocInitialized().call()
		);
		keysManagerNewAddress.should.be.equal(
			await proxyStorageInstance.methods.getKeysManager().call()
		);
		keysManagerNewAddress.should.be.equal(
			await poaNewInstance.methods.getKeysManager().call()
		);
		votingToChangeKeysNewAddress.should.be.equal(
			await proxyStorageInstance.methods.getVotingToChangeKeys().call()
		);
		votingToChangeMinThresholdNewAddress.should.be.equal(
			await proxyStorageInstance.methods.getVotingToChangeMinThreshold().call()
		);
		votingToChangeProxyNewAddress.should.be.equal(
			await proxyStorageInstance.methods.getVotingToChangeProxy().call()
		);
		votingToManageEmissionFundsAddress.should.be.equal(
			await proxyStorageInstance.methods.getVotingToManageEmissionFunds().call()
		);
		ballotsStorageNewAddress.should.be.equal(
			await proxyStorageInstance.methods.getBallotsStorage().call()
		);
		process.env.METADATA_NEW_ADDRESS.should.be.equal(
			await proxyStorageInstance.methods.getValidatorMetadata().call()
		);
		rewardByBlockAddress.should.be.equal(
			await proxyStorageInstance.methods.getRewardByBlock().call()
		);
		const keysManagerNewInstance = new web3.eth.Contract(keysManagerNewAbi, keysManagerNewAddress);
		const ballotsStorageNewInstance = new web3.eth.Contract(ballotsStorageNewAbi, ballotsStorageNewAddress);
		const votingToChangeKeysNewInstance = new web3.eth.Contract(votingToChangeKeysNewAbi, votingToChangeKeysNewAddress);
		const votingToChangeMinThresholdNewInstance = new web3.eth.Contract(votingToChangeMinThresholdNewAbi, votingToChangeMinThresholdNewAddress);
		const votingToChangeProxyNewInstance = new web3.eth.Contract(votingToChangeProxyNewAbi, votingToChangeProxyNewAddress);
		const validatorMetadataNewInstance = new web3.eth.Contract(metadataCompiled.abi, process.env.METADATA_NEW_ADDRESS);
		process.env.PROXY_STORAGE_NEW_ADDRESS.should.be.equal(
			await keysManagerNewInstance.methods.proxyStorage().call()
		);
		process.env.PROXY_STORAGE_NEW_ADDRESS.should.be.equal(
			await ballotsStorageNewInstance.methods.proxyStorage().call()
		);
		process.env.PROXY_STORAGE_NEW_ADDRESS.should.be.equal(
			await votingToChangeKeysNewInstance.methods.proxyStorage().call()
		);
		process.env.PROXY_STORAGE_NEW_ADDRESS.should.be.equal(
			await votingToChangeMinThresholdNewInstance.methods.proxyStorage().call()
		);
		process.env.PROXY_STORAGE_NEW_ADDRESS.should.be.equal(
			await votingToChangeProxyNewInstance.methods.proxyStorage().call()
		);
		process.env.PROXY_STORAGE_NEW_ADDRESS.should.be.equal(
			await votingToManageEmissionFundsInstance.methods.proxyStorage().call()
		);
		process.env.PROXY_STORAGE_NEW_ADDRESS.should.be.equal(
			await rewardByBlockInstance.methods.proxyStorage().call()
		);
		process.env.PROXY_STORAGE_NEW_ADDRESS.should.be.equal(
			await validatorMetadataNewInstance.methods.proxyStorage().call()
		);
		console.log('Success');
		console.log('');

		await runExternalScript('./addValidators.js');

		console.log('Disable migrations feature of the ValidatorMetadata contract...');
		await utils.call(validatorMetadataNewInstance.methods.initMetadataDisable(), sender, process.env.METADATA_NEW_ADDRESS, key, chainId);
		true.should.be.equal(await validatorMetadataNewInstance.methods.initMetadataDisabled().call());
		console.log('');

		console.log('Save contracts.json...');
		const networkPath = `./kovan`;
		const contractsJSONPath = `${networkPath}/contracts.json`;
		const contractsJSONContent =
`{
	"VOTING_TO_CHANGE_KEYS_ADDRESS": "${votingToChangeKeysNewAddress}",
	"VOTING_TO_CHANGE_MIN_THRESHOLD_ADDRESS": "${votingToChangeMinThresholdNewAddress}",
	"VOTING_TO_CHANGE_PROXY_ADDRESS": "${votingToChangeProxyNewAddress}",
	"VOTING_TO_MANAGE_EMISSION_FUNDS_ADDRESS": "${votingToManageEmissionFundsAddress}",
	"BALLOTS_STORAGE_ADDRESS": "${ballotsStorageNewAddress}",
	"KEYS_MANAGER_ADDRESS": "${keysManagerNewAddress}",
	"METADATA_ADDRESS": "${process.env.METADATA_NEW_ADDRESS}",
	"PROXY_ADDRESS": "${process.env.PROXY_STORAGE_NEW_ADDRESS}",
	"POA_ADDRESS": "${process.env.POA_CONSENSUS_NEW_ADDRESS}",
	"EMISSION_FUNDS_ADDRESS": "${emissionFundsAddress}",
	"REWARD_BY_BLOCK_ADDRESS": "${rewardByBlockAddress}",
	"MOC": "${process.env.MOC}"
}`;
		if (!fs.existsSync(networkPath)) fs.mkdirSync(networkPath);
		fs.writeFileSync(contractsJSONPath, contractsJSONContent);
		console.log('Success');
		console.log('');

		console.log('Save ABIs...');
		const abisPath = `${networkPath}/abis`;
		if (!fs.existsSync(abisPath)) fs.mkdirSync(abisPath);
		fs.writeFileSync(`${abisPath}/BallotsStorage.abi.json`, JSON.stringify(ballotsStorageNewAbi, null, '  '));
		fs.writeFileSync(`${abisPath}/EmissionFunds.abi.json`, JSON.stringify(emissionFundsCompiled.abi, null, '  '));
		fs.writeFileSync(`${abisPath}/KeysManager.abi.json`, JSON.stringify(keysManagerNewAbi, null, '  '));
		fs.writeFileSync(`${abisPath}/PoaNetworkConsensus.abi.json`, JSON.stringify(poaCompiled.abi, null, '  '));
		fs.writeFileSync(`${abisPath}/ProxyStorage.abi.json`, JSON.stringify(proxyStorageCompiled.abi, null, '  '));
		fs.writeFileSync(`${abisPath}/RewardByBlock.abi.json`, JSON.stringify(rewardByBlockCompiled.abi, null, '  '));
		fs.writeFileSync(`${abisPath}/ValidatorMetadata.abi.json`, JSON.stringify(metadataCompiled.abi, null, '  '));
		fs.writeFileSync(`${abisPath}/VotingToChangeKeys.abi.json`, JSON.stringify(votingToChangeKeysNewAbi, null, '  '));
		fs.writeFileSync(`${abisPath}/VotingToChangeMinThreshold.abi.json`, JSON.stringify(votingToChangeMinThresholdNewAbi, null, '  '));
		fs.writeFileSync(`${abisPath}/VotingToChangeProxyAddress.abi.json`, JSON.stringify(votingToChangeProxyNewAbi, null, '  '));
		fs.writeFileSync(`${abisPath}/VotingToManageEmissionFunds.abi.json`, JSON.stringify(votingToManageEmissionFundsCompiled.abi, null, '  '));
		console.log('Success');
		console.log('');

		console.log(`Deployment to Kovan network is successful.`);
		console.log(`New addresses have been saved to ${contractsJSONPath}`);
		console.log(`New ABIs have been saved to ${abisPath}`);
	} catch (err) {
		console.log(err);
	}
}

async function runExternalScript(scriptPath) {
	return new Promise((resolve, reject) => {
		let invoked = false;
		let proc = childProcess.fork(scriptPath);
		let returnValue;

		proc.on('error', function (err) {
			if (invoked) return;
			invoked = true;
			reject(err);
		});

		proc.on('message', function (msg) {
			returnValue = msg;
		});

		proc.on('exit', function (code) {
			if (invoked) return;
			invoked = true;
			
			if (code === 0) {
				resolve(returnValue);
			} else {
				reject(new Error('exit code ' + code));
			}
		});
	});
}

// node deployAll