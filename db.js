// db.js
// Owns the single Neo4j/CognoDB driver instance for the whole app.
// CognoDB speaks openCypher over Bolt, so the official neo4j-driver package
// works against it unmodified — we just point it at the CognoDB URI.

const neo4j = require('neo4j-driver');

const URI = process.env.COGNODB_URI;
const USER = process.env.COGNODB_USER || 'cognodb';
const PASSWORD = process.env.COGNODB_PASSWORD;

let driver = null;
let connectionError = null;

function getDriver() {
  if (driver) return driver;

  if (!URI || !PASSWORD) {
    connectionError = new Error(
      'Missing COGNODB_URI or COGNODB_PASSWORD environment variables. ' +
      'Copy .env.example to .env and fill in your CognoDB Cloud connection details.'
    );
    throw connectionError;
  }

  driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD), {
    maxConnectionPoolSize: 20, // stay well under the free tier's 200 connection cap
  });

  return driver;
}

// Verifies connectivity once at boot so we fail fast with a clear message
// instead of letting every request hit a confusing driver error.
async function verifyConnection() {
  try {
    const d = getDriver();
    await d.verifyConnectivity();
    connectionError = null;
    return { ok: true };
  } catch (err) {
    connectionError = err;
    return { ok: false, error: err.message };
  }
}

// Runs a Cypher query with parameters (never string-concatenated) and
// always closes its session, even on error.
async function runQuery(cypher, params = {}) {
  if (connectionError) {
    // Don't even attempt the query if we know the DB is unreachable —
    // fail fast with a clean, user-facing error instead of a driver stack trace.
    throw new Error('Database unavailable: ' + connectionError.message);
  }
  const session = getDriver().session();
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

module.exports = { getDriver, verifyConnection, runQuery };
