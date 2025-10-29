import express from "express";
import cors from "cors";
import axios from "axios";
import fs from "fs";
import path from "path";
import { createCanvas } from "canvas";
import mysql from 'mysql2';
import dotenv from "dotenv";

dotenv.config();


const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3031;
let database = [];

let bulkInsert = [];

const generateSummaryImage = async () => {
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
        ctx.fillText(`Last refreshed at: ${database.length > 0 ? database[0].last_refreshed_at : "N/A"}`, 50, 110);

        // Top 5 countries by GDP
        const lineHeight = 30;
        ctx.fillText("Top 5 countries by GDP:", 50, 140);
        const countriesToShow = database.sort((a, b) => b.estimated_gdp - a.estimated_gdp);

        countriesToShow.slice(0, 5).forEach((country, index) => {
            ctx.fillText(`${index + 1}. ${country.name}: $${country.estimated_gdp.toFixed(2)}`, 50, 170 + index * lineHeight);
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
            console.log('Table truncated!')
        });

        const exchangeRates = responseExchangeRate.data.rates;
        const randomNum = (Math.random() * 1000) + 1000;
        console.log(randomNum)

        const formattedCountry = countriesData.map((country, index) => {
            let singleInsert = [];
            const currency = country.currencies?.[0] || { code: null };
            let exchangeRate = exchangeRates[currency.code] || 0;
            let estimatedGdp = exchangeRate === 0 ? 0 : country.population * randomNum / exchangeRate;
            estimatedGdp = estimatedGdp.toFixed();

            if (!exchangeRates[currency.code]) {
                estimatedGdp = null;
                exchangeRate = null;
            }


            // connection.query("INSERT INTO countries (name, capital, region, population, flag_url, currency_code, exchange_rate, estimated_gdp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [country.name, country.capital, country.region, country.population, country.flag, currency.code, exchangeRate, estimatedGdp], (error, results) => {
            //     if (error) {
            //         console.error("Error inserting/updating country:", error);
            //     }
            // });
            singleInsert = [
                country.name,
                country.capital,
                country.region,
                country.population,
                country.flag,             
                currency.code,
                exchangeRate,
                estimatedGdp
            ];

            bulkInsert.push(singleInsert);





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


        const sql = `
  INSERT INTO countries 
  (name, capital, region, population, flag_url, currency_code, exchange_rate, estimated_gdp) 
  VALUES ?
`;
        connection.query(sql, [bulkInsert], (error, results) => {
            if (error) {
                console.error("Error inserting countries:", error);
            } else {
                console.log("Inserted countries successfully:", results.affectedRows);
            }
        });


        await generateSummaryImage();

        return res.status(200).json(formattedCountry);
    } catch (error) {
        console.error("Error refreshing database:", error);
        res.status(500).json({ message: "Error refreshing database" });
    }
});

app.get("/countries/image", async (req, res) => {

    await generateSummaryImage();
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
        const countryname = req.params.name.toLowerCase();

        connection.query("SELECT * FROM countries WHERE LOWER(name) = ?", [countryname], (error, results) => {
            if (error) {
                console.error("Error querying the database:", error);
                return res.status(500).send("Internal Server Error");
            }
            let country = results[0];

            if (results.length > 0) {
                const validationObject = {
                    "error": "Validation failed"
                };

                const details = {};

                if (!country.name) {
                    details.name = "is required";
                }

                if (!country.population) {
                    details.population = "is required";
                }

                if (country.currency_code == 0) {
                    details.currency_code = "is required";
                }

                if (Object.keys(details).length > 0) {
                    validationObject.details = details;
                    return res.status(400).json(validationObject);
                }

                res.status(200).json(results);
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


                filteredCountries = filteredCountries.filter(c => c.region.toLowerCase() === req.query.region.toLowerCase());
            }

            if (req.query.currency) {
                filteredCountries = filteredCountries.filter(c => c.currency_code.toLowerCase() === req.query.currency.toLowerCase());
            }

            if (req.query.sort) {
                if (req.query.sort === "gdp_asc") {
                    filteredCountries.sort((a, b) => a.estimated_gdp - b.estimated_gdp);
                } else if (req.query.sort === "gdp_desc") {
                    filteredCountries.sort((a, b) => b.estimated_gdp - a.estimated_gdp);
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

        const countryname = req.params.name.toLowerCase();

        connection.query("DELETE FROM countries WHERE LOWER(name) = ?", [countryname], (error, results) => {
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
            const last_refreshed_at = total_countries > 0 ? results[0].last_refreshed_at : null;
            return res.status(200).json({ total_countries, last_refreshed_at });
        });

    } catch (error) {
        console.error("Error connecting to the database:", error);
        return res.status(500).send("Internal Server Error");
    }


});

app.get("/setup", (req, res) => {
    try {

        connection.query(`DROP TABLE countries`, (error, result) => {
            if (error) {
                console.error("Error Deleting the table:", error);
                return res.status(500).send("Internal Server Error");
            }
            console.log('table dropped!')
        });

        connection.query(`CREATE TABLE  countries (
                        id int(11) NOT NULL PRIMARY KEY AUTO_INCREMENT,
                        name varchar(250) NOT NULL,
                        capital varchar(250) DEFAULT NULL,
                        region varchar(250) DEFAULT NULL,
                        population int(9) NOT NULL,
                        currency_code varchar(3),
                        EXCHANGE_RATE int(9),
                        estimated_gdp BIGINT,
                        FLAG_URL varchar(250) DEFAULT NULL,
                        last_refreshed_at timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
                        )`, (error, results) => {
            if (error) {
                console.error("Error querying the database:", error);
                return res.status(500).send("Internal Server Error");
            }

            console.log('table created!')
            return res.status(200).json({
                message: "Table created successfully"
            });
        });
    } catch (error) {
        console.error("Error deleting country:", error);
        res.status(500).json({ message: "Error deleting country" });
    }
});

app.get("/clear", (req, res) => {
    try {

        connection.query(`TRUNCATE TABLE countries`, (error, result) => {
            if (error) {
                console.error("Error Deleting the table:", error);
                return res.status(500).send("Internal Server Error");
            }
            console.log('table truncated!')
            res.status(200).json({
                message: "Table cleared!"
            })
        });
    } catch (error) {
        console.log(error)
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});