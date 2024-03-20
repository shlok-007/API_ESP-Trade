"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// import express, { Request, Response } from "express";
var express = require("express");
// import fs from "fs";
var fs = require("fs");
// import path from "path";
var path = require("path");
var express_rate_limit_1 = require("express-rate-limit");
// import cors from "cors";
var cors = require("cors");
var app = express();
// Configure rate limiter
var limiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 10,
    message: "Too many requests from this IP, please try again later.",
});
// Enable CORS
app.use(cors());
// Apply rate limiter to all requests
app.use(limiter);
// Path to the file containing historical market data
var dataFilePath = path.join(__dirname, "market_data.json");
var transactionLogFilePath = path.join(__dirname, "transactions_log.json");
var dayOffset = 0;
var startingTimestamp = new Date("2024-03-19T22:30:00Z");
// Cache variable to store market data
var marketData = [];
// Function to read market data from file and cache it
var readMarketDataFromFile = function () {
    try {
        var data = fs.readFileSync(dataFilePath, "utf8");
        marketData = JSON.parse(data);
        console.log("Market data read from file:", marketData.length, "data points");
    }
    catch (err) {
        console.error("Error reading market data file:", err);
    }
};
// Read market data from file and cache it during server startup
readMarketDataFromFile();
var allowedTeamIDs = [
    "38.1",
    "38.2",
    "23.1",
    "23.2",
    "99.1",
    "99.2",
    "19.1",
    "19.2",
    "65.1",
    "65.2",
];
var teamData = {};
var init_balance = 10000;
// Middleware function to validate team ID
var validateTeamID = function (req, res, next) {
    var teamid = req.query.teamid;
    if (!teamid || !allowedTeamIDs.includes(teamid)) {
        return res.status(401).json({ error: "Unauthorized. Invalid team ID." });
    }
    // If team ID is valid, initialize team data if not already initialized
    if (!teamData[teamid]) {
        teamData[teamid] = { balance: init_balance, stocks: 0 }; // Initial balance for each team
        console.log("Initialized data for team:", teamid);
    }
    // If team's balance is zero, disallow trading
    if (teamData[teamid].balance <= 0) {
        return res.status(403).json({ error: "Forbidden. Insufficient balance." });
    }
    // If team's stocks are zero and they're attempting to sell, disallow trading
    if (teamData[teamid].stocks <= 0 && req.path === "/api/sell") {
        return res
            .status(403)
            .json({ error: "Forbidden. Insufficient stocks to sell." });
    }
    // If team ID is valid and trading is allowed, proceed to the next middleware/route handler
    next();
};
// Function to calculate the current stock price based on the current timestamp
var getCurrentStockPrice = function (x) {
    // Assuming each data point represents one minute
    var dataPointIntervalInMinutes = 1;
    // Get the current system time
    var currentTime = new Date();
    // Calculate the difference in minutes between the starting timestamp and current time
    var timeDiffInMinutes = Math.floor((currentTime.getTime() - startingTimestamp.getTime()) /
        (1000 * 60 * dataPointIntervalInMinutes));
    // Calculate the row number of the data to be served
    var rowNumber = Math.max(0, Math.min(timeDiffInMinutes, marketData.length - 1));
    // Return the 'close' price as the stock price at the calculated row number
    if (x)
        return marketData[rowNumber];
    return marketData[rowNumber].close;
};
// Middleware function to log transactions
var logTransaction = function (teamID, action, amount, stockPrice) {
    var transaction = {
        teamID: teamID,
        action: action,
        amount: amount,
        stockPrice: stockPrice,
        // time + 5.5
        timestamp: new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000).toISOString(),
    };
    try {
        // const transactionLogFilePath = path.join(__dirname, 'transaction_log.json');
        var transactions = [];
        if (fs.existsSync(transactionLogFilePath)) {
            // Read existing transactions from the file
            var data = fs.readFileSync(transactionLogFilePath, "utf8");
            transactions = JSON.parse(data);
        }
        // Append the new transaction to the existing transactions array
        transactions.push(transaction);
        // Write the updated transactions array back to the file
        fs.writeFileSync(transactionLogFilePath, JSON.stringify(transactions, null, 2));
        // console.log('Transaction logged:', transaction);
    }
    catch (err) {
        console.error("Error logging transaction:", err);
    }
};
// Endpoint to serve historical market data for a stock
app.get("/api/curr-stock-data", validateTeamID, function (req, res) {
    // Get the current stock price
    var stockPrice = getCurrentStockPrice(true);
    res.json(stockPrice);
});
// Endpoint to buy stocks
app.post("/api/buy", validateTeamID, function (req, res) {
    var _a = req.query, teamid = _a.teamid, amount = _a.amount;
    // Get the current stock price
    var stockPrice = parseFloat(getCurrentStockPrice(false));
    // Perform buy operation
    var buyAmount = parseFloat(amount);
    teamData[teamid].balance -= buyAmount * stockPrice;
    teamData[teamid].stocks += buyAmount;
    // Log transaction
    logTransaction(teamid, "buy", buyAmount, stockPrice);
    //   console.log("Transaction logged");
    res.json({
        message: "Successfully bought ".concat(buyAmount, " stocks at $").concat(stockPrice, " per stock."),
    });
});
// Endpoint to sell stocks
app.post("/api/sell", validateTeamID, function (req, res) {
    var _a = req.query, teamid = _a.teamid, amount = _a.amount;
    // Get the current stock price
    var stockPrice = parseFloat(getCurrentStockPrice(false));
    // Perform sell operation
    var sellAmount = parseFloat(amount);
    teamData[teamid].balance += sellAmount * stockPrice;
    teamData[teamid].stocks -= sellAmount;
    // Log transaction
    logTransaction(teamid, "sell", sellAmount, stockPrice);
    res.json({
        message: "Successfully sold ".concat(sellAmount, " stocks at $").concat(stockPrice, " per stock."),
    });
});
// Endpoint to get team status
app.get("/api/mystatus", validateTeamID, function (req, res) {
    var teamid = req.query.teamid;
    var teamStatus = teamData[teamid];
    res.json(teamStatus);
});
// Endpoint to get all transactions for a team
app.get("/api/transactions", validateTeamID, function (req, res) {
    var teamid = req.query.teamid;
    try {
        var data = fs.readFileSync(transactionLogFilePath, "utf8");
        var allTransactions = JSON.parse(data);
        // Filter transactions for the specific team
        var teamTransactions = allTransactions.filter(function (transaction) {
            return transaction.teamID === teamid;
        });
        res.json({ transactions: teamTransactions });
    }
    catch (err) {
        console.error("Error reading transaction log file:", err);
        res.status(500).json({ error: "Internal server error." });
    }
});
// Faucet endpoint to get free money for testing
app.post("/api/faucet", validateTeamID, function (req, res) {
    var teamid = req.query.teamid;
    teamData[teamid].balance += init_balance;
    logTransaction(teamid, "faucet", init_balance, 0);
    res.json({ message: "Successfully received $".concat(init_balance, " from faucet.") });
});
// Start the server
var PORT = process.env.PORT || 2268;
app.listen(PORT, function () {
    console.log("Server is running on port ".concat(PORT));
});
