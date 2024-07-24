const express = require("express");
const neo4j = require("neo4j-driver");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(cors());

const driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "banABNa0411!"), {
  encrypted: "ENCRYPTION_OFF"
});
const session = driver.session();

const data = [
  { name: "A", description: "This is a description of A", parent: "" },
  { name: "B", description: "This is a description of B", parent: "A" },
  { name: "C", description: "This is a description of C", parent: "A" },
  { name: "D", description: "This is a description of D", parent: "A" },
  { name: "B-1", description: "This is a description of B-1", parent: "B" },
  { name: "B-2", description: "This is a description of B-2", parent: "B" },
  { name: "B-3", description: "This is a description of B-3", parent: "B" }
];

const fetchData = async () => {
  const session = driver.session();
  try {
    const result = await session.executeRead(tx =>
      tx.run(`
        MATCH (n:Node)
        OPTIONAL MATCH (n)-[:HAS_CHILD]->(child)
        RETURN n, collect(child) as children
      `)
    );

    const nodes = result.records.map(record => {
      const node = record.get("n").properties;
      const children = record
        .get("children")
        .map(child => child.properties)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      return { node, children };
    });

    const rootNodes = buildHierarchy(nodes);

    return rootNodes;
  } finally {
    await session.close();
  }
};

const buildHierarchy = nodes => {
  const nodeMap = new Map();

  // Creating node map structure
  nodes.forEach(({ node }) => {
    nodeMap.set(node.name, { ...node, children: [] });
  });

  // Add corresponding children to root nodes
  nodes.forEach(({ node, children }) => {
    const currentNode = nodeMap.get(node.name);
    children.forEach(child => {
      const childNode = nodeMap.get(child.name);
      if (childNode) {
        currentNode.children.push(childNode);
      }
    });

    // Sorting children by name
    currentNode.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  });

  // Remove root nodes which are children of other nodes
  const rootNodes = [];
  nodes.forEach(({ node }) => {
    if (!nodes.some(({ children }) => children.some(child => child.name === node.name))) {
      rootNodes.push(nodeMap.get(node.name));
    }
  });

  return rootNodes;
};

app.post("/populate", async (req, res) => {
  try {
    await session.executeWrite(tx => tx.run("MATCH (n) DETACH DELETE n"));

    for (const item of data) {
      await session.executeWrite(tx =>
        tx.run("CREATE (n:Node {name: $name, description: $description})", {
          name: item.name,
          description: item.description
        })
      );

      if (item.parent) {
        await session.executeWrite(tx =>
          tx.run("MATCH (a:Node {name: $parent}), (b:Node {name: $name}) CREATE (a)-[:HAS_CHILD]->(b)", {
            parent: item.parent,
            name: item.name
          })
        );
      }
    }

    res.status(200).send("Database populated");
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.get("/nodes", async (req, res) => {
  try {
    const data = await fetchData();
    res.json(data);
  } catch (error) {
    console.error("Error fetching node data:", error);
    res.status(500).send("Error fetching node data");
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
