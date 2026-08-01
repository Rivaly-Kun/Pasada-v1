import { compileFile } from "cashc"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const contractName = "PasadaEscrow"
const artifact = compileFile(resolve("contracts", `${contractName}.cash`))
await mkdir(resolve("src", "contracts"), { recursive: true })
await writeFile(
  resolve("src", "contracts", `${contractName}.json`),
  `${JSON.stringify(artifact, null, 2)}\n`,
)
