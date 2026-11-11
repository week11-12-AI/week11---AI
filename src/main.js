import { mountGame } from "./game.js";
import { createRunStorage } from "./storage.js";

const storage = createRunStorage(document.querySelector('meta[name="mini-react-run"]')?.content);
mountGame(document.getElementById("game"), storage);
