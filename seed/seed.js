// seed/seed.js
// Populates CognoDB with a realistic small trust network: people, the
// neighborhoods they live in, service providers, the categories they
// offer, and two kinds of edges — social TRUST between people, and
// RECOMMENDS from a person to a provider they've actually used.
//
// Run with: npm run seed

require('dotenv').config();
const neo4j = require('neo4j-driver');

const URI = process.env.COGNODB_URI;
const USER = process.env.COGNODB_USER || 'cognodb';
const PASSWORD = process.env.COGNODB_PASSWORD;

if (!URI || !PASSWORD) {
  console.error('Missing COGNODB_URI or COGNODB_PASSWORD. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const neighborhoods = ['Riverside', 'Oakwood', 'Fort Kochi', 'Elamkulam', 'Kadavanthra'];

const services = ['Plumber', 'Electrician', 'Carpenter', 'AC Repair', 'House Cleaning', 'Painter', 'Pest Control'];

const people = [
  { id: 'p1', name: 'Anjali Menon', neighborhood: 'Riverside' },
  { id: 'p2', name: 'Ravi Nair', neighborhood: 'Oakwood' },
  { id: 'p3', name: 'Fathima Zahra', neighborhood: 'Fort Kochi' },
  { id: 'p4', name: 'Thomas George', neighborhood: 'Elamkulam' },
  { id: 'p5', name: 'Devika Pillai', neighborhood: 'Kadavanthra' },
  { id: 'p6', name: 'Arun Kumar', neighborhood: 'Riverside' },
  { id: 'p7', name: 'Neha Joseph', neighborhood: 'Oakwood' },
  { id: 'p8', name: 'Sanjay Varma', neighborhood: 'Fort Kochi' },
  { id: 'p9', name: 'Meera Krishnan', neighborhood: 'Elamkulam' },
  { id: 'p10', name: 'Vishnu Prasad', neighborhood: 'Kadavanthra' },
  { id: 'p11', name: 'Lakshmi Iyer', neighborhood: 'Riverside' },
  { id: 'p12', name: 'Kiran Thomas', neighborhood: 'Oakwood' },
];

const providers = [
  { id: 'sp1', name: 'QuickFix Plumbing', services: ['Plumber'], neighborhood: 'Riverside' },
  { id: 'sp2', name: 'BrightSpark Electric', services: ['Electrician'], neighborhood: 'Oakwood' },
  { id: 'sp3', name: 'CoolBreeze AC Services', services: ['AC Repair'], neighborhood: 'Fort Kochi' },
  { id: 'sp4', name: 'Kerala Woodworks', services: ['Carpenter'], neighborhood: 'Elamkulam' },
  { id: 'sp5', name: 'SparklePro Cleaning', services: ['House Cleaning'], neighborhood: 'Kadavanthra' },
  { id: 'sp6', name: 'Nair Plumbing & Sons', services: ['Plumber'], neighborhood: 'Oakwood' },
  { id: 'sp7', name: 'VoltRight Electricians', services: ['Electrician', 'AC Repair'], neighborhood: 'Riverside' },
  { id: 'sp8', name: 'GreenGuard Pest Control', services: ['Pest Control'], neighborhood: 'Fort Kochi' },
  { id: 'sp9', name: 'Coastal Painters', services: ['Painter'], neighborhood: 'Elamkulam' },
  { id: 'sp10', name: 'HomeCraft Carpentry', services: ['Carpenter', 'Painter'], neighborhood: 'Kadavanthra' },
];

// TRUSTS edges: directional, weighted by closeness (1-5). Deliberately
// forms chains 3+ hops deep so the multi-hop query has something to walk.
const trustEdges = [
  ['p1', 'p2', 5], ['p1', 'p3', 3], ['p2', 'p4', 4], ['p2', 'p5', 3],
  ['p3', 'p6', 4], ['p4', 'p7', 5], ['p5', 'p8', 3], ['p6', 'p9', 4],
  ['p7', 'p10', 3], ['p8', 'p11', 4], ['p9', 'p12', 5], ['p10', 'p1', 2],
  ['p11', 'p2', 3], ['p12', 'p3', 4], ['p1', 'p6', 4], ['p2', 'p9', 3],
  ['p5', 'p11', 4], ['p7', 'p12', 3],
];

// RECOMMENDS edges: person -> provider, with a 1-5 star rating.
const recommendEdges = [
  ['p2', 'sp1', 5], ['p4', 'sp2', 4], ['p6', 'sp3', 5], ['p7', 'sp4', 4],
  ['p8', 'sp5', 3], ['p9', 'sp6', 5], ['p10', 'sp7', 4], ['p11', 'sp8', 5],
  ['p12', 'sp9', 4], ['p3', 'sp10', 5], ['p9', 'sp1', 4], ['p12', 'sp2', 5],
  ['p6', 'sp7', 5], ['p11', 'sp3', 4], ['p10', 'sp6', 3], ['p7', 'sp9', 5],
  ['p2', 'sp6', 4], ['p4', 'sp8', 4],
];

async function main() {
  const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));
  const session = driver.session();

  try {
    console.log('Verifying connection to CognoDB...');
    await driver.verifyConnectivity();
    console.log('✔ Connected.');

    console.log('Clearing existing data...');
    await session.run('MATCH (n) DETACH DELETE n');

    console.log('Creating constraints...');
    await session.run('CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT provider_id IF NOT EXISTS FOR (p:ServiceProvider) REQUIRE p.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT service_name IF NOT EXISTS FOR (s:Service) REQUIRE s.name IS UNIQUE');
    await session.run('CREATE CONSTRAINT neighborhood_name IF NOT EXISTS FOR (n:Neighborhood) REQUIRE n.name IS UNIQUE');

    console.log('Creating neighborhoods and services...');
    for (const n of neighborhoods) {
      await session.run('MERGE (:Neighborhood {name: $name})', { name: n });
    }
    for (const s of services) {
      await session.run('MERGE (:Service {name: $name})', { name: s });
    }

    console.log('Creating people...');
    for (const p of people) {
      await session.run(
        `MERGE (person:Person {id: $id})
         SET person.name = $name
         WITH person
         MATCH (n:Neighborhood {name: $neighborhood})
         MERGE (person)-[:LIVES_IN]->(n)`,
        p
      );
    }

    console.log('Creating service providers...');
    for (const sp of providers) {
      await session.run(
        `MERGE (provider:ServiceProvider {id: $id})
         SET provider.name = $name
         WITH provider
         MATCH (n:Neighborhood {name: $neighborhood})
         MERGE (provider)-[:LOCATED_IN]->(n)`,
        sp
      );
      for (const svcName of sp.services) {
        await session.run(
          `MATCH (provider:ServiceProvider {id: $id}), (s:Service {name: $svcName})
           MERGE (provider)-[:PROVIDES]->(s)`,
          { id: sp.id, svcName }
        );
      }
    }

    console.log('Creating TRUSTS relationships...');
    for (const [from, to, strength] of trustEdges) {
      await session.run(
        `MATCH (a:Person {id: $from}), (b:Person {id: $to})
         MERGE (a)-[t:TRUSTS]->(b)
         SET t.strength = $strength`,
        { from, to, strength }
      );
    }

    console.log('Creating RECOMMENDS relationships...');
    for (const [from, to, rating] of recommendEdges) {
      await session.run(
        `MATCH (a:Person {id: $from}), (b:ServiceProvider {id: $to})
         MERGE (a)-[r:RECOMMENDS]->(b)
         SET r.rating = $rating`,
        { from, to, rating }
      );
    }

    const counts = await session.run(
      `MATCH (n) RETURN labels(n)[0] AS label, count(*) AS c ORDER BY label`
    );
    console.log('\nSeed complete. Node counts:');
    counts.records.forEach(r => console.log(`  ${r.get('label')}: ${r.get('c').toNumber()}`));
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await session.close();
    await driver.close();
  }
}

main();
