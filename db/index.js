const mongoose = require('mongoose');
const dotenv = require('dotenv')
dotenv.config()

function db () {
  return mongoose
  .connect(process.env.DATABASE_URL, {
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.log(err.message));
}  

module.exports = db;
