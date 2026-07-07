const fs = require("fs");
const path = "/home/cs/bimaru/bimaru-harbor-library.json";

const library = JSON.parse(fs.readFileSync(path, "utf-8"));

const nameMap = { 1: "ARCHIPELAGO #3", 2: "ARCHIPELAGO #2", 3: "ARCHIPELAGO #1", 4: "ARCHIPELAGO #5", 5: "ARCHIPELAGO #6" };

for (const puzzle of library) {
  if (!puzzle.name && nameMap[puzzle.id]) {
    puzzle.name = nameMap[puzzle.id];
  }
}

fs.writeFileSync(path, JSON.stringify(library, null, 2) + "\n", "utf-8");

for (const puzzle of library) {
  console.log(`ID ${puzzle.id}${puzzle.name ? ` — "${puzzle.name}"` : " — (no name)"} [${puzzle.difficulty}]`);
}
