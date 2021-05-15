"use strict";

const express = require("express");
const app = express();
const morgan = require("morgan");
const Blockchain = require("./blockchain");
const uuid = require("uuid/v1");
const port = process.argv[2];
const rp = require("request-promise");

const nodeAddress = uuid().split("-").join("");

const bitcoin = new Blockchain();


app.use(morgan("tiny"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// get entire blockchain
app.get("/blockchain", function (req, res) {
	res.send(bitcoin);
});

// create a new transaction
app.post("/transaction", function (req, res) {
	console.log("in transaction");
	const newTransaction = req.body;
	console.log(req);
	const blockIndex =
		bitcoin.addTransactionToPendingTransactions(newTransaction);
	res.json({ note: `Transaction will be added in block ${blockIndex}.` });
});


// broadcast transaction
app.post("/transaction/broadcast", function (req, res) {
	const newTransaction = bitcoin.createNewTransaction(
		req.body.amount,
		req.body.sender,
		req.body.recipient
	);
	bitcoin.addTransactionToPendingTransactions(newTransaction);

	const requestPromises = [];
	bitcoin.networkNodes.forEach((networkNodeUrl) => {
		const requestOptions = {
			uri: networkNodeUrl + "/transaction",
			method: "POST",
			body: newTransaction,
			json: true,
		};

		requestPromises.push(rp(requestOptions));
	});

	Promise.all(requestPromises).then((data) => {
		res.json({ note: "Transaction created and broadcast successfully." });
	});
});


// mine a block
app.get("/mine", function (req, res) {
	const lastBlock = bitcoin.getLastBlock();
	const previousBlockHash = lastBlock["hash"];
	const currentBlockData = {
		transactions: bitcoin.pendingTransactions,
		index: lastBlock["index"] + 1,
	};
	const nonce = bitcoin.proofOfWork(previousBlockHash, currentBlockData);
	const blockHash = bitcoin.hashBlock(
		previousBlockHash,
		currentBlockData,
		nonce
	);
	const newBlock = bitcoin.createNewBlock(nonce, previousBlockHash, blockHash);

	const requestPromises = [];
	bitcoin.networkNodes.forEach((networkNodeUrl) => {
		const requestOptions = {
			uri: networkNodeUrl + "/receive-new-block",
			method: "POST",
			body: { newBlock: newBlock },
			json: true,
		};

		requestPromises.push(rp(requestOptions));
	});

	Promise.all(requestPromises)
		.then((data) => {
			const requestOptions = {
				uri: bitcoin.currentNodeUrl + "/transaction/broadcast",
				method: "POST",
				body: {
					amount: 12.5,
					sender: "00",
					recipient: nodeAddress,
				},
				json: true,
			};

			return rp(requestOptions);
		})
		.then((data) => {
			res.json({
				note: "New block mined & broadcast successfully",
				block: newBlock,
			});
		});
});

// receive new block
app.post("/receive-new-block", function (req, res) {
	const newBlock = req.body.newBlock;
	const lastBlock = bitcoin.getLastBlock();
	const correctHash = lastBlock.hash === newBlock.previousBlockHash;
	const correctIndex = lastBlock["index"] + 1 === newBlock["index"];

	if (correctHash && correctIndex) {
		bitcoin.chain.push(newBlock);
		bitcoin.pendingTransactions = [];
		res.json({
			note: "New block received and accepted.",
			newBlock: newBlock,
		});
	} else {
		res.json({
			note: "New block rejected.",
			newBlock: newBlock,
		});
	}
});

// consensus
app.get("/consensus", function (req, res) {
	const requestPromises = [];
	bitcoin.networkNodes.forEach((networkNodeUrl) => {
		const requestOptions = {
			uri: networkNodeUrl + "/blockchain",
			method: "GET",
			json: true,
		};

		requestPromises.push(rp(requestOptions));
	});

	Promise.all(requestPromises).then((blockchains) => {
		const currentChainLength = bitcoin.chain.length;
		let maxChainLength = currentChainLength;
		let newLongestChain = null;
		let newPendingTransactions = null;

		blockchains.forEach((blockchain) => {
			if (blockchain.chain.length > maxChainLength) {
				maxChainLength = blockchain.chain.length;
				newLongestChain = blockchain.chain;
				newPendingTransactions = blockchain.pendingTransactions;
			}
		});

		if (
			!newLongestChain ||
			(newLongestChain && !bitcoin.chainIsValid(newLongestChain))
		) {
			res.json({
				note: "Current chain has not been replaced.",
				chain: bitcoin.chain,
			});
		} else {
			bitcoin.chain = newLongestChain;
			bitcoin.pendingTransactions = newPendingTransactions;
			res.json({
				note: "This chain has been replaced.",
				chain: bitcoin.chain,
			});
		}
	});
});

// get block by blockHash
app.get("/block/:blockHash", function (req, res) {
	const blockHash = req.params.blockHash;
	const correctBlock = bitcoin.getBlock(blockHash);
	res.json({
		block: correctBlock,
	});
});

// get transaction by transactionId
app.get("/transaction/:transactionId", function (req, res) {
	const transactionId = req.params.transactionId;
	const trasactionData = bitcoin.getTransaction(transactionId);
	res.json({
		transaction: trasactionData.transaction,
		block: trasactionData.block,
	});
});

// get address by address
app.get("/address/:address", function (req, res) {
	const address = req.params.address;
	const addressData = bitcoin.getAddressData(address);
	res.json({
		addressData: addressData,
	});
});

// block explorer
app.get("/block-explorer", function (req, res) {
	res.sendFile("./block-explorer/index.html", { root: __dirname });
});
app.get("/", (req, res) => {
	res.sendFile("./block-explorer/home.html", { root: __dirname });
});



app.listen(port, function () {
	console.log(`Listening on port ${port}...`);
});
