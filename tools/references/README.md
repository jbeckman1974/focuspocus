# Local reference archive

Run this from the project root on a machine that can reach the publishers.

```sh
python3 -B tools/references/archive.py
```

The copier saves original HTML and PDF response bodies under `build/OmniFocus/copies/`. Open `build/OmniFocus/index.html` for the catalog. Select a capture date to open the local file or a title to visit the publisher. An unavailable source has an error in the index. The JSON manifest records the requested and final URLs, UTC capture time, content type, byte length and SHA-256. The Mac 4.10.1 release-notes capture requires the baseline version and release date on Omni's live page.

The editable [source catalog](sources.tsv) lists the release notes, versioned manual chapters and technical references used for the project. The copier follows HTTPS redirects only to publishers already in that catalog. It reads at most 16 MiB per source with bounded network timeouts. Each file is an original page or document. Images, stylesheets and interactive features linked by HTML may still require the publisher's website.

Re-run the command after a connection failure. It checks existing file hashes and fetches missing documents. Use `--refresh` to capture changed editions while retaining older copies. A failed refresh keeps the last verified capture available. The command returns a nonzero status if any requested source fails. It never asks for a publisher account. Copies and their generated index stay under the project's ignored `build/` directory.

Run the tests without publisher access.

```sh
python3 -B -m unittest discover -s tools/references -v
```
