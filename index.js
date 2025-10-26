import express from "express";
import cors from "cors";
import axios from "axios";
import fs from "fs";
import path from "path";
import { createCanvas } from "canvas";
import mysql from 'mysql';
import dotenv from "dotenv";

dotenv.config();


const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3031;
let database = [];

const generateSummaryImage = () => {
    connection.query("SELECT * FROM countries", (error, results) => {
        if (error) {
            console.error("Error querying the database:", error);
            return res.status(500).send("Internal Server Error");
        }

        database = results;

        const __dirname = path.resolve();
        const CACHE_PATH = path.join(__dirname, "cache", "summary.png");
        if (!fs.existsSync("cache")) fs.mkdirSync("cache");

        // Generate summary image
        const canvas = createCanvas(800, 600);
        const ctx = canvas.getContext("2d");

        // Background
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Title
        ctx.fillStyle = "#000";
        ctx.font = "bold 30px Arial";
        ctx.fillText("Countries Summary", 50, 50);

        // Total countries
        ctx.font = "16px Arial";
        ctx.fillStyle = "#000";

        ctx.fillText(`Total countries: ${database.length}`, 50, 80);
        // console.log(database)

        // Timestamp
        ctx.fillText(`Last refreshed at: ${database.length > 0 ? database[0].LAST_REFRESHED_AT : "N/A"}`, 50, 110);

        // Top 5 countries by GDP
        const lineHeight = 30;
        ctx.fillText("Top 5 countries by GDP:", 50, 140);
        const countriesToShow = database.sort((a, b) => b.ESTIMATED_GDP - a.ESTIMATED_GDP);

        countriesToShow.slice(0, 5).forEach((country, index) => {
            ctx.fillText(`${index + 1}. ${country.NAME}: $${country.ESTIMATED_GDP.toFixed(2)}`, 50, 170 + index * lineHeight);
        });

        // Save the image to cache
        const buffer = canvas.toBuffer("image/png");
        fs.writeFileSync(CACHE_PATH, buffer);
    });
}

app.get("/test", (req, res) => {

    try {
        connection.query("INSERT INTO countries (name, capital, region, population, flag_url, currency_code) VALUES (?, ?, ?, ?, ?, ?)", ["Nigeria", "Abuja", "Africa", 20000000, "https://flagcdn.com/ng.svg", "NGN"], (error, results) => {
            if (error) {
                console.error("Error querying the database:", error);
                return res.status(500).send("Internal Server Error");
            }
            console.log("Database insert results:", results);
            return res.send("Database connection successful.");
        })
    } catch (error) {
        console.error("Error connecting to the database:", error);
        return res.status(500).send("Internal Server Error");
    }
});

app.get("/check", (req, res) => {

    try {
        connection.query("SELECT * FROM countries", (error, results) => {
            if (error) {
                console.error("Error querying the database:", error);
                return res.status(500).send("Internal Server Error");
            }
            console.log("Database query results:", results);
            // database = results;
            connection.end();
            res.status(200).json(results);
            // return res.send("Welcome to the Countries API");
        });
    } catch (error) {
        console.error("Error connecting to the database:", error);
        return res.status(500).send("Internal Server Error");
    }
});


app.post("/countries/refresh", async (req, res) => {
    try {
        const responseCountries = await axios.get("https://restcountries.com/v2/all?fields=name,capital,region,population,flag,currencies");

        if (responseCountries.status !== 200 || !Array.isArray(responseCountries.data)) {
            return res.status(503).json({ "error": "External data source unavailable", "details": "Could not fetch data from restcountries.com" });
        }

        const countriesData = responseCountries.data;


        const responseExchangeRate = await axios.get(`https://open.er-api.com/v6/latest/USD`);
        if (responseExchangeRate.status !== 200 || responseExchangeRate.data.result !== "success") {
            return res.status(503).json({ "error": "External data source unavailable", "details": "Could not fetch data from open.er-api.com" });
        }

        connection.query("TRUNCATE TABLE countries", (error, results) => {
            if (error) {
                console.error("Error truncating countries table:", error);
            }
        });

        const exchangeRates = responseExchangeRate.data.rates;
        const randomNum = (Math.random() * 1000) + 1000;
        console.log(randomNum)

        countriesData.map((country, index) => {
            const currency = country.currencies && country.currencies.length > 0 ? country.currencies[0] : { code: "N/A" };
            const exchangeRate = exchangeRates[currency.code] || 0;
            const estimatedGdp = exchangeRate === 0 ? 0 : country.population * randomNum / exchangeRate;

            connection.query("INSERT INTO countries (name, capital, region, population, flag_url, currency_code, exchange_rate, estimated_gdp, last_refreshed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [country.name, country.capital, country.region, country.population, country.flag, currency.code, exchangeRate, estimatedGdp, new Date().toISOString()], (error, results) => {
                if (error) {
                    console.error("Error inserting/updating country:", error);
                }
            });

            const validationObject = {
                "error": "Validation failed"
            };

            const details = {};

            if (country.name === undefined) {
                details.name = "is required";
            }

            if (country.population === undefined) {
                details.population = "is required";
            }

            // if (country.currency_code === undefined) {
            //     details.currency_code = "is required";
            // }

            if (Object.keys(details).length > 0) {
                validationObject.details = details;
                return res.status(400).json(validationObject);
            }

            return {
                id: index + 1,
                name: country.name,
                capital: country.capital,
                region: country.region,
                population: country.population,
                currency_code: currency.code,
                exchange_rate: exchangeRate,
                estimated_gdp: estimatedGdp,
                flag_url: country.flag,
                last_refreshed_at: new Date().toISOString()
            };
        });

        generateSummaryImage();

        res.status(200).json(countriesData);
    } catch (error) {
        console.error("Error refreshing database:", error);
        res.status(500).json({ message: "Error refreshing database" });
    }
});

app.get("/countries/image", (req, res) => {

    const __dirname = path.resolve();
    const CACHE_PATH = path.join(__dirname, "cache", "summary.png");
    if (!fs.existsSync(CACHE_PATH)) {
        return res.status(404).json({ error: "Summary image not found" });
    }
    res.setHeader("Content-Type", "image/png");
    res.sendFile(CACHE_PATH);
});

app.get("/countries/:name", (req, res) => {

    try {
        const countryName = req.params.name.toLowerCase();

        connection.query("SELECT * FROM countries WHERE LOWER(name) = ?", [countryName], (error, results) => {
            if (error) {
                console.error("Error querying the database:", error);
                return res.status(500).send("Internal Server Error");
            }

            if (results.length > 0) {
                res.status(200).json(results[0]);
            } else {
                res.status(404).json({ message: "Country not found" });
            }
        });

    } catch (error) {
        console.error("Error connecting to the database:", error);
        return res.status(500).send("Internal Server Error");
    }

});

app.get("/countries", (req, res) => {

    try {
        let filteredCountries = [];

        connection.query("SELECT * FROM countries", (error, results) => {
            if (error) {
                console.error("Error querying the database:", error);
                return res.status(500).send("Internal Server Error");
            }

            filteredCountries = results;
            if (req.query.region) {


                filteredCountries = filteredCountries.filter(c => c.REGION === req.query.region);
            }

            if (req.query.currency) {
                filteredCountries = filteredCountries.filter(c => c.CURRENCY_CODE.toLowerCase() === req.query.currency.toLowerCase());
            }

            if (req.query.sort) {
                if (req.query.sort === "gdp_asc") {
                    filteredCountries.sort((a, b) => a.ESTIMATED_GDP - b.ESTIMATED_GDP);
                } else if (req.query.sort === "gdp_desc") {
                    filteredCountries.sort((a, b) => b.ESTIMATED_GDP - a.ESTIMATED_GDP);
                }
            }

            return res.status(200).json(filteredCountries);
        });

    } catch (error) {
        console.error("Error fetching countries:", error);
        res.status(500).json({ message: "Error fetching countries" });
    }
});

app.delete("/countries/:name", (req, res) => {

    try {

        const countryName = req.params.name.toLowerCase();

        connection.query("DELETE FROM countries WHERE LOWER(name) = ?", [countryName], (error, results) => {
            if (error) {
                console.error("Error querying the database:", error);
                return res.status(500).send("Internal Server Error");
            }

            if (results.affectedRows > 0) {
                res.status(200).send();
            } else {
                res.status(404).json({ message: "Country not found" });
            }
        });
    } catch (error) {
        console.error("Error deleting country:", error);
        res.status(500).json({ message: "Error deleting country" });
    }
});

// GET /status
app.get("/status", (req, res) => {

    try {
        connection.query("SELECT * FROM countries", (error, results) => {
            if (error) {
                console.error("Error querying the database:", error);
                return res.status(500).send("Internal Server Error");
            }
            console.log(results);

            const total_countries = results.length;
            const last_refreshed_at = total_countries > 0 ? results[0].LAST_REFRESHED_AT : null;
            res.status(200).json({ total_countries, last_refreshed_at });
        });

    } catch (error) {
        console.error("Error connecting to the database:", error);
        return res.status(500).send("Internal Server Error");
    }


});
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});