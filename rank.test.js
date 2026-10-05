const test = require("node:test");
const assert = require("node:assert");
const { rank, buildQuery } = require("../server.js");

const now = new Date().toISOString();
const jobs = [
  { id: "a", title: "Senior Backend Engineer", company: "A", location: "Remote", remote: true, posted: now, tags: ["python", "kubernetes"], description: "Build distributed systems in Python and Go on Kubernetes and AWS. PostgreSQL, gRPC." },
  { id: "b", title: "Marketing Coordinator", company: "B", location: "Remote", remote: true, posted: now, tags: ["marketing"], description: "Run social media campaigns, write newsletters, coordinate events." },
  { id: "c", title: "Junior Backend Developer", company: "C", location: "Remote", remote: true, posted: now, tags: ["python"], description: "Entry level role writing Python APIs." },
  { id: "d", title: "Senior Backend Engineer", company: "D", location: "Berlin", remote: false, posted: now, tags: ["go"], description: "Distributed systems in Go and Python, Kubernetes, AWS, on-site in Berlin." },
  ...["Account Executive", "Registered Nurse", "Graphic Designer", "Data Entry Clerk", "Customer Support Agent"].map((title, i) => ({
    id: "filler" + i, title, company: "F", location: "Remote", remote: true, posted: now, tags: [], description: title + " role with competitive pay and benefits.",
  })),
];
const profile = { role: "Senior Backend Engineer", level: "Senior", mode: "Remote", location: "", resume: "Backend engineer. Python, Go, PostgreSQL, Kubernetes, AWS, distributed systems, gRPC APIs." };

test("ranks the matching remote role first", () => {
  const r = rank(jobs, profile);
  assert.strictEqual(r[0].id, "a");
  assert.ok(r[0].score > 80);
});

test("scores an unrelated role below related ones", () => {
  const r = rank(jobs, profile);
  const score = (id) => r.find(j => j.id === id).score;
  assert.ok(score("b") < score("a"));
  assert.ok(score("b") < score("d"));
});

test("penalises seniority and work-style mismatches", () => {
  const r = rank(jobs, profile);
  const score = (id) => r.find(j => j.id === id).score;
  assert.ok(score("a") > score("c"), "junior role should score below senior");
  assert.ok(score("a") > score("d"), "on-site role should score below remote");
});

test("lists matched resume skills", () => {
  const r = rank(jobs, profile);
  const matched = r.find(j => j.id === "a").matched;
  assert.ok(matched.includes("distributed systems"));
  assert.ok(!matched.includes("ran"));
});

test("builds search terms from the target role", () => {
  const q = buildQuery(profile);
  assert.strictEqual(q.searchTerms[0], "backend engineer");
  assert.ok(q.museCategories.includes("Software Engineering"));
});
