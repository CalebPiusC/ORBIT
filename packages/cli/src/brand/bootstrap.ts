// Imported first by the CLI entrypoint: it must run before any module that creates Orbit's global
// directories, otherwise the migration would see a populated Orbit folder and skip the import.
import { migrateLegacyData } from "./migrate"

migrateLegacyData()
