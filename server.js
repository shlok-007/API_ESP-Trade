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
var startingTimestamp = new Date("2024-03-20T04:00:00Z");
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
// <TeamID>.<TeamNumber>
var apiKeys = {
    "38.1": "op8L9vcGfuCwlHIVEMUM55ugcisbkWjP",
    "38.2": "ptEMhrBr3Yu0bE2iMFZkgwQZAJprbcx2",
    "23.1": "YcxRCxEbvI1gyVg93ekfIuChVIP8vwcF",
    "23.2": "OCCeIsDLOFe9tcXERioLP8UV86kevc7H",
    "99.1": "ilr3r4csxHas7roU1pPr7MvKK6SXHxyT",
    "99.2": "b9i9zNDBYZ0ZvsnK2c2Pzctwark56FKL",
    "19.1": "qzrmt1k4UbUTl2BO4zyjqhf07BtHVBOz",
    "19.2": "td53qoCNU417d44LEz7GJw0y0eJjiGHe",
    "65.1": "U3E4crk15do5MA2M8FOgwYPgotXDkFtM",
    "65.2": "9qEj11Jwyc483S8gZ0NEHW1bCINwbTIt",
};
var teamData = {};
var init_balance = 10000;
var restoreTeamDataFromTransactionLog = function () {
    try {
        // Read transactions from the log file
        var data = fs.readFileSync(transactionLogFilePath, "utf8");
        var allTransactions = JSON.parse(data);
        // Iterate through each transaction
        allTransactions.forEach(function (transaction) {
            var teamID = transaction.teamID, action = transaction.action, amount = transaction.amount, stockPrice = transaction.stockPrice;
            // If team data doesn't exist, initialize it with initial balance and stocks
            if (!teamData[teamID]) {
                teamData[teamID] = { balance: init_balance, stocks: 0 };
            }
            // Update team's balance and stocks based on the transaction
            if (action === "buy") {
                teamData[teamID].balance -= amount * stockPrice;
                teamData[teamID].stocks += amount;
            }
            else if (action === "sell") {
                teamData[teamID].balance += amount * stockPrice;
                teamData[teamID].stocks -= amount;
            }
        });
        console.log("Team data restored from transaction log successfully.");
    }
    catch (err) {
        console.error("Error restoring team data from transaction log:", err);
    }
};
// Restore team data from transaction log during server startup
restoreTeamDataFromTransactionLog();
// Middleware function to validate team ID
var validateAccess = function (req, res, next) {
    var teamid = req.headers["teamid"];
    var apiKey = req.headers["api-key"];
    if (!teamid ||
        !allowedTeamIDs.includes(teamid) ||
        !apiKey ||
        apiKey !== apiKeys[teamid]) {
        return res
            .status(401)
            .json({ error: "Unauthorized. Invalid team ID/API key." });
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
    var currentTime = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
    // Calculate the difference in minutes between the starting timestamp and current time
    var timeDiffInMinutes = Math.floor((currentTime.getTime() - startingTimestamp.getTime()) /
        (1000 * 60 * dataPointIntervalInMinutes));
    // Calculate the row number of the data to be served
    var rowNumber = Math.max(0, Math.min(timeDiffInMinutes, marketData.length - 1));
    marketData[rowNumber].time = currentTime.toISOString();
    if (x)
        return marketData[rowNumber];
    return marketData[rowNumber].close;
};
// Array to store transactions in memory
var transactionBuffer = [];
// Function to log transactions to the buffer
var logTransaction = function (teamID, action, amount, stockPrice) {
    var transaction = {
        teamID: teamID,
        action: action,
        amount: amount,
        stockPrice: stockPrice,
        timestamp: new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000).toISOString(),
    };
    // Push the new transaction to the buffer
    transactionBuffer.push(transaction);
};
// Function to periodically write transactions from buffer to file
var flushTransactionBuffer = function () {
    if (transactionBuffer.length > 0) {
        try {
            // Read existing transactions from the file
            var data = fs.readFileSync(transactionLogFilePath, "utf8");
            var existingTransactions = JSON.parse(data);
            // Append the transactions from buffer to existing transactions
            var allTransactions = existingTransactions.concat(transactionBuffer);
            // Write all transactions back to the file
            fs.writeFileSync(transactionLogFilePath, JSON.stringify(allTransactions, null, 2));
            // Clear the transaction buffer after writing
            transactionBuffer = [];
            console.log("Transactions flushed to file successfully.");
        }
        catch (err) {
            console.error("Error flushing transactions to file:", err);
        }
    }
};
// Set interval to periodically flush transaction buffer to file (e.g., every 5 minutes)
setInterval(flushTransactionBuffer, 5 * 60 * 1000); // Adjust the interval as needed
// Endpoint to serve historical market data for a stock
app.get("/api/curr-stock-data", validateAccess, function (req, res) {
    // Get the current stock price
    var stockPrice = getCurrentStockPrice(true);
    res.json(stockPrice);
});
// Endpoint to buy stocks
app.post("/api/buy", validateAccess, function (req, res) {
    var teamid = req.headers["teamid"];
    var amount = req.query.amount;
    // Get the current stock price
    var stockPrice = parseFloat(getCurrentStockPrice(false));
    // Perform buy operation
    var buyAmount = parseFloat(amount);
    if (buyAmount * stockPrice > teamData[teamid].balance) {
        return res.status(403).json({ error: "Forbidden. Insufficient balance." });
    }
    teamData[teamid].balance -= buyAmount * stockPrice;
    teamData[teamid].stocks += buyAmount;
    // Log transaction
    logTransaction(teamid, "buy", buyAmount, stockPrice);
    res.json({
        message: "Successfully bought ".concat(buyAmount, " stocks at $").concat(stockPrice, " per stock."),
    });
});
// Endpoint to sell stocks
app.post("/api/sell", validateAccess, function (req, res) {
    var teamid = req.headers["teamid"];
    var amount = req.query.amount;
    if (teamData[teamid].stocks < parseFloat(amount)) {
        return res
            .status(403)
            .json({ error: "Forbidden. Insufficient stocks to sell." });
    }
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
app.get("/api/mystatus", validateAccess, function (req, res) {
    var teamid = req.headers["teamid"];
    var teamStatus = teamData[teamid];
    res.json(teamStatus);
});
// Endpoint to get all transactions for a team
app.get("/api/transactions", validateAccess, function (req, res) {
    var teamid = req.headers["teamid"];
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
app.post("/api/faucet", validateAccess, function (req, res) {
    var teamid = req.headers["teamid"];
    if (teamData[teamid].balance >= 10000) {
        return res
            .status(403)
            .json({ error: "Forbidden. You already have enough balance." });
    }
    teamData[teamid].balance += init_balance;
    logTransaction(teamid, "faucet", init_balance, 0);
    res.json({ message: "Successfully received $".concat(init_balance, " from faucet.") });
});
// Start the server
var PORT = process.env.PORT || 2268;
app.listen(PORT, function () {
    console.log("Server is running on port ".concat(PORT));
});
