// import express, { Request, Response } from "express";
import express = require("express");
import { Request, Response } from "express";
// import fs from "fs";
import fs = require("fs");
// import path from "path";
import path = require("path");
import rateLimit from "express-rate-limit";
// import cors from "cors";
import cors = require("cors");

const app = express();

// Configure rate limiter
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 10, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});

// Enable CORS
app.use(cors());

// Apply rate limiter to all requests
app.use(limiter);

// Path to the file containing historical market data
const dataFilePath = path.join(__dirname, "market_data.json");
const transactionLogFilePath = path.join(__dirname, "transactions_log.json");

const dayOffset = 0;
const startingTimestamp = new Date("2024-03-19T22:30:00Z");

interface MarketData {
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  time: string;
}

// Cache variable to store market data
let marketData: MarketData[] = [];

// Function to read market data from file and cache it
const readMarketDataFromFile = (): void => {
  try {
    const data = fs.readFileSync(dataFilePath, "utf8");
    marketData = JSON.parse(data);
    console.log(
      "Market data read from file:",
      marketData.length,
      "data points"
    );
  } catch (err) {
    console.error("Error reading market data file:", err);
  }
};

// Read market data from file and cache it during server startup
readMarketDataFromFile();

const allowedTeamIDs = [
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

const apiKeys : { [key: string]: string } = {
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

// Object to store team data (balance and stock holdings)
interface TeamData {
  balance: number;
  stocks: number;
}

let teamData: { [key: string]: TeamData } = {};
const init_balance = 10000;

// Middleware function to validate team ID
const validateAccess = (req: Request, res: Response, next: any) => {
  const { teamid } = req.query;
  const apiKey = req.headers["api-key"] as string;

  if (!teamid || !allowedTeamIDs.includes(teamid as string) || !apiKey || apiKey !== apiKeys[teamid as string]) {
    return res.status(401).json({ error: "Unauthorized. Invalid team ID/API key." });
  }

  // If team ID is valid, initialize team data if not already initialized
  if (!teamData[teamid as string]) {
    teamData[teamid as string] = { balance: init_balance, stocks: 0 }; // Initial balance for each team
    console.log("Initialized data for team:", teamid);
  }

  // If team's balance is zero, disallow trading
  if (teamData[teamid as string].balance <= 0) {
    return res.status(403).json({ error: "Forbidden. Insufficient balance." });
  }

  // If team's stocks are zero and they're attempting to sell, disallow trading
  if (teamData[teamid as string].stocks <= 0 && req.path === "/api/sell") {
    return res
      .status(403)
      .json({ error: "Forbidden. Insufficient stocks to sell." });
  }

  // If team ID is valid and trading is allowed, proceed to the next middleware/route handler
  next();
};

// Function to calculate the current stock price based on the current timestamp
const getCurrentStockPrice = (x: boolean): string | MarketData => {
  // Assuming each data point represents one minute
  const dataPointIntervalInMinutes = 1;

  // Get the current system time
  const currentTime = new Date();

  // Calculate the difference in minutes between the starting timestamp and current time
  const timeDiffInMinutes = Math.floor(
    (currentTime.getTime() - startingTimestamp.getTime()) /
      (1000 * 60 * dataPointIntervalInMinutes)
  );

  // Calculate the row number of the data to be served
  const rowNumber = Math.max(
    0,
    Math.min(timeDiffInMinutes, marketData.length - 1)
  );

  // Return the 'close' price as the stock price at the calculated row number
  if (x) return marketData[rowNumber];
  return marketData[rowNumber].close;
};

// Middleware function to log transactions
const logTransaction = (
  teamID: string,
  action: string,
  amount: number,
  stockPrice: number
) => {
  const transaction = {
    teamID,
    action,
    amount,
    stockPrice,
    // time + 5.5
    timestamp: new Date(
      new Date().getTime() + 5.5 * 60 * 60 * 1000
    ).toISOString(),
  };

  try {
    // const transactionLogFilePath = path.join(__dirname, 'transaction_log.json');
    let transactions: any[] = [];
    if (fs.existsSync(transactionLogFilePath)) {
      // Read existing transactions from the file
      const data = fs.readFileSync(transactionLogFilePath, "utf8");
      transactions = JSON.parse(data);
    }

    // Append the new transaction to the existing transactions array
    transactions.push(transaction);

    // Write the updated transactions array back to the file
    fs.writeFileSync(
      transactionLogFilePath,
      JSON.stringify(transactions, null, 2)
    );

    // console.log('Transaction logged:', transaction);
  } catch (err) {
    console.error("Error logging transaction:", err);
  }
};

// Endpoint to serve historical market data for a stock
app.get(
  "/api/curr-stock-data",
  validateAccess,
  (req: Request, res: Response) => {
    // Get the current stock price
    const stockPrice = getCurrentStockPrice(true);

    res.json(stockPrice);
  }
);

// Endpoint to buy stocks
app.post("/api/buy", validateAccess, (req: Request, res: Response) => {
  const { teamid, amount } = req.query;
  // Get the current stock price
  let stockPrice = parseFloat(getCurrentStockPrice(false) as string);

  // Perform buy operation
  const buyAmount = parseFloat(amount as string);
  teamData[teamid as string].balance -= buyAmount * stockPrice;
  teamData[teamid as string].stocks += buyAmount;
  // Log transaction
  logTransaction(teamid as string, "buy", buyAmount, stockPrice);
//   console.log("Transaction logged");

  res.json({
    message: `Successfully bought ${buyAmount} stocks at $${stockPrice} per stock.`,
  });
});

// Endpoint to sell stocks
app.post("/api/sell", validateAccess, (req: Request, res: Response) => {
  const { teamid, amount } = req.query;

  // Get the current stock price
  let stockPrice = parseFloat(getCurrentStockPrice(false) as string);

  // Perform sell operation
  const sellAmount = parseFloat(amount as string);
  teamData[teamid as string].balance += sellAmount * stockPrice;
  teamData[teamid as string].stocks -= sellAmount;
  // Log transaction
  logTransaction(teamid as string, "sell", sellAmount, stockPrice);

  res.json({
    message: `Successfully sold ${sellAmount} stocks at $${stockPrice} per stock.`,
  });
});

// Endpoint to get team status
app.get("/api/mystatus", validateAccess, (req: Request, res: Response) => {
  const { teamid } = req.query;
  const teamStatus = teamData[teamid as string];
  res.json(teamStatus);
});

// Endpoint to get all transactions for a team
app.get("/api/transactions", validateAccess, (req: Request, res: Response) => {
  const { teamid } = req.query;

  try {
    const data = fs.readFileSync(transactionLogFilePath, "utf8");
    const allTransactions = JSON.parse(data);
    // Filter transactions for the specific team
    const teamTransactions = allTransactions.filter((transaction: any) => {
      return transaction.teamID === teamid;
    });

    res.json({ transactions: teamTransactions });
  } catch (err) {
    console.error("Error reading transaction log file:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Faucet endpoint to get free money for testing
app.post("/api/faucet", validateAccess, (req: Request, res: Response) => {
  const { teamid } = req.query;
  teamData[teamid as string].balance += init_balance;
  logTransaction(teamid as string, "faucet", init_balance, 0);
  res.json({ message: `Successfully received $${init_balance} from faucet.` });
});

// Start the server
const PORT = process.env.PORT || 2268;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
