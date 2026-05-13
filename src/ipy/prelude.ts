/**
 * Prelude loader - imports the Python prelude as a text asset.
 */
import preludeContent from "../prelude.py" with { type: "text" };

export const PYTHON_PRELUDE = preludeContent;
