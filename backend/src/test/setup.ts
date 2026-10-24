import dotenv from "dotenv";
import { URL } from "node:url";

// Always load the dedicated test database connection before app/Prisma imports.
const result = dotenv.config({
  path: ".env.test",
  override: true,
});

if (result.error) {
  throw new Error(
    "Test database configuration missing: backend/.env.test could not be loaded.",
  );
}

process.env.NODE_ENV = "test";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing from backend/.env.test.");
}

let databaseName: string;

try {
  databaseName = new URL(connectionString).pathname
    .replace(/^\//, "")
    .split("?")[0];
} catch {
  throw new Error("The test DATABASE_URL is not a valid URL.");
}

if (databaseName !== "ceh_test_db") {
  throw new Error(
    `Refusing to run tests against "${databaseName}". Expected "ceh_test_db".`,
  );
}

console.log("Integration tests are configured for ceh_test_db.");
