# Documentation site

This folder is the [MkDocs Material](https://squidfunk.github.io/mkdocs-material/) site for people using the app and its API. The pages live in `docs/`, and the navigation is in `mkdocs.yml`.

To preview it locally with Python:

```bash
pip install -r mkdocs/requirements.txt
mkdocs serve -f mkdocs/mkdocs.yml
```

The pages are plain Markdown, so they also read fine on GitHub. Start with [the API specification](docs/api/overview.md).
