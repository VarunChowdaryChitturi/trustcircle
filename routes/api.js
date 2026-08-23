// routes/api.js
// Every query here is parameterised — user input is passed as Cypher
// parameters ($name, $id, ...), never string-concatenated into the query text.

const express = require('express');
const { runQuery } = require('../db');
const router = express.Router();

// Small helper so every route has the same graceful-failure shape.
function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err);
      res.status(503).json({ error: err.message || 'Something went wrong talking to the database.' });
    }
  };
}

// GET /api/people — for the "who am I" picker in the UI
router.get('/people', handle(async (req, res) => {
  const records = await runQuery(
    `MATCH (p:Person) RETURN p.id AS id, p.name AS name ORDER BY p.name`
  );
  res.json(records.map(r => ({ id: r.get('id'), name: r.get('name') })));
}));

// GET /api/services — list of service categories, for the filter dropdown
router.get('/services', handle(async (req, res) => {
  const records = await runQuery(
    `MATCH (s:Service) RETURN s.name AS name ORDER BY s.name`
  );
  res.json(records.map(r => r.get('name')));
}));

/*
 * GET /api/recommendations?personId=...&service=...&maxHops=3
 *
 * THE CORE QUERY — multi-hop, trust-weighted recommendation.
 *
 * Starting from a person, walk outward through their TRUSTS network up to
 * `maxHops` hops, collect every ServiceProvider recommended by anyone on
 * that path, and rank providers by a trust-weighted score: recommendations
 * from people you trust directly count more than recommendations from
 * people three hops away.
 *
 * This is the query a relational database finds genuinely awkward: it's an
 * unbounded/variable-depth walk (variable-length pattern matching), it
 * needs to track the *path* to compute a decaying weight per hop, and it
 * needs to dedupe/aggregate across many possible paths to the same
 * provider. In SQL this is either a recursive CTE with manual depth
 * bookkeeping, or N self-joins per hop depth — both far messier than the
 * native path pattern below.
 */
router.get('/recommendations', handle(async (req, res) => {
  const { personId, service, maxHops = '3' } = req.query;
  if (!personId) return res.status(400).json({ error: 'personId is required' });

  const hops = Math.max(1, Math.min(4, parseInt(maxHops, 10) || 3));

  const cypher = `
    MATCH (me:Person {id: $personId})
    MATCH path = (me)-[:TRUSTS*1..${hops}]->(truster:Person)
    MATCH (truster)-[rec:RECOMMENDS]->(provider:ServiceProvider)
    WHERE $service IS NULL OR EXISTS {
      MATCH (provider)-[:PROVIDES]->(s:Service {name: $service})
    }
    WITH provider, truster, rec, length(path) AS distance
    WITH provider,
         collect(DISTINCT truster.name) AS recommendedBy,
         sum(rec.rating * 1.0 / distance) AS trustScore,
         count(DISTINCT truster) AS recommenderCount
    OPTIONAL MATCH (provider)-[:PROVIDES]->(svc:Service)
    OPTIONAL MATCH (provider)-[:LOCATED_IN]->(n:Neighborhood)
    RETURN provider.id AS id,
           provider.name AS name,
           collect(DISTINCT svc.name) AS services,
           n.name AS neighborhood,
           recommendedBy,
           recommenderCount,
           trustScore
    ORDER BY trustScore DESC
    LIMIT 20
  `;

  const records = await runQuery(cypher, { personId, service: service || null });
  res.json(records.map(r => ({
    id: r.get('id'),
    name: r.get('name'),
    services: r.get('services'),
    neighborhood: r.get('neighborhood'),
    recommendedBy: r.get('recommendedBy'),
    recommenderCount: r.get('recommenderCount').toNumber ? r.get('recommenderCount').toNumber() : r.get('recommenderCount'),
    trustScore: Math.round(r.get('trustScore') * 100) / 100,
  })));
}));

/*
 * GET /api/trust-path?fromId=...&toId=...
 *
 * Shortest trust path between two people, of any length, using Cypher's
 * shortestPath(). This answers "how am I connected to this person, and
 * through whom?" — a classic graph-native question. In a relational model
 * you don't know the path depth in advance, so you can't write a fixed
 * number of joins; you'd need a recursive query engine bolted on, and you
 * still wouldn't get the path itself back as naturally as a graph does.
 */
router.get('/trust-path', handle(async (req, res) => {
  const { fromId, toId } = req.query;
  if (!fromId || !toId) return res.status(400).json({ error: 'fromId and toId are required' });

  const cypher = `
    MATCH (a:Person {id: $fromId}), (b:Person {id: $toId})
    MATCH path = shortestPath((a)-[:TRUSTS*..6]->(b))
    RETURN [n IN nodes(path) | n.name] AS names,
           length(path) AS hops
  `;
  const records = await runQuery(cypher, { fromId, toId });
  if (records.length === 0) {
    return res.json({ connected: false });
  }
  res.json({
    connected: true,
    names: records[0].get('names'),
    hops: records[0].get('hops').toNumber ? records[0].get('hops').toNumber() : records[0].get('hops'),
  });
}));

/*
 * GET /api/hidden-gems?personId=...
 *
 * Providers your extended network (2+ hops) rates highly but that nobody
 * in your *direct* trust circle has recommended yet — i.e. providers you
 * likely haven't heard of but are pre-vetted by people-you-trust's
 * trusted people. A second-degree-only filter like this is another
 * multi-hop pattern that's natural in Cypher and clunky in SQL.
 */
router.get('/hidden-gems', handle(async (req, res) => {
  const { personId } = req.query;
  if (!personId) return res.status(400).json({ error: 'personId is required' });

  const cypher = `
    MATCH (me:Person {id: $personId})
    MATCH (me)-[:TRUSTS]->(direct:Person)
    MATCH (me)-[:TRUSTS]->(:Person)-[:TRUSTS]->(indirect:Person)
    WHERE NOT (indirect)-[:TRUSTS]-(me) AND indirect <> me
    MATCH (indirect)-[rec:RECOMMENDS]->(provider:ServiceProvider)
    WHERE NOT (direct)-[:RECOMMENDS]->(provider) AND rec.rating >= 4
    WITH DISTINCT provider, rec
    OPTIONAL MATCH (provider)-[:PROVIDES]->(svc:Service)
    RETURN provider.id AS id, provider.name AS name,
           collect(DISTINCT svc.name) AS services,
           avg(rec.rating) AS avgRating
    ORDER BY avgRating DESC
    LIMIT 10
  `;
  const records = await runQuery(cypher, { personId });
  res.json(records.map(r => ({
    id: r.get('id'),
    name: r.get('name'),
    services: r.get('services'),
    avgRating: Math.round(r.get('avgRating') * 10) / 10,
  })));
}));

module.exports = router;
