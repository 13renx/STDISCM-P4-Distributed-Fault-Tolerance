/**
 * server/DbConnect.js
 * -----------------------------------------------------------------------------
 * Keeps the original connectDB() entry point that the rest of the app imports,
 * but backs it with the fault-tolerant DatabaseService (Person C - Lance).
 *
 * Two important behavioural changes vs. the original:
 *   1. It AWAITS the connection and reports real success/failure (the original
 *      logged "Connected" before the promise resolved).
 *   2. It does NOT call process.exit() when the database node is unreachable.
 *      Killing the app node on DB failure would violate the requirement that
 *      non-DB features keep working when the DB node is down. Instead it logs
 *      the error and lets the app keep serving; the Mongo driver retries in the
 *      background and DatabaseService.getStatus() reflects the current state.
 */

// import databaseService from './db/databaseService.js';

// const connectDB = async () => {
//   try {
//     await databaseService.connect();
//     console.log('Connected to MongoDB');
//     return databaseService;
//   } catch (error) {
//     console.error(`Database node unreachable (app will keep serving non-DB routes): ${error.message}`);
//     return databaseService; // stay alive; do not exit the process.
//   }
// };

// export default connectDB;
// export { databaseService };
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const dbUri = process.env.MONGODB_URI;

// Do not exit the process on DB failure: the DB going down must not take the
// rest of the app (routes unrelated to login) down with it. mongoose.connect()
// rejects/emits asynchronously, so both the initial promise and later
// connection errors are handled here instead of a try/catch.
const connectDB = () => {
  mongoose.connection.on("error", (error) => {
    console.error(`MongoDB connection error, app will keep serving non-DB routes: ${error.message}`);
  });

  return mongoose.connect(dbUri)
    .then((conn) => {
      console.log("Connected to MongoDB");
      return conn;
    })
    .catch((error) => {
      console.error(`Database unreachable, app will keep serving non-DB routes: ${error.message}`);
      return null;
    });
};

export default connectDB;