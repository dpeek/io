import { createExampleRuntime } from "./runtime";

const { graph, ids } = createExampleRuntime();

console.log("Company by id:", graph.company.get(ids.acme));
console.log("All companies:", graph.company.list());
console.log("Person by chain:", graph.person.node(ids.alice).get());

console.log("Updated company:", graph.company.get(ids.acme));
