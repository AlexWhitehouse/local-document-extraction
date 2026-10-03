# Documentation site

This folder contains the [MkDocs Material](https://squidfunk.github.io/mkdocs-material/) site for app users and API clients. Pages are in `docs/`. `mkdocs.yml` defines navigation.

To preview the site locally, run these Python commands:

```bash
pip install -r mkdocs/requirements.txt
mkdocs serve -f mkdocs/mkdocs.yml
```

The pages use Markdown and can also be read on GitHub. Start with the [API specification](docs/api/overview.md).
