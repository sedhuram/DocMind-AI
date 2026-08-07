# DocMind AI Overview

DocMind AI is a retrieval-augmented generation system for answering questions about a document
collection. It ingests files from two sources: a static directory scanned on startup, and files
uploaded through the web UI. Both sources are merged into one searchable collection.

The system uses Google's Gemini API for both embeddings (gemini-embedding-001) and answer
generation (gemini-3.6-flash). Documents are split into overlapping chunks of about 1000
characters with 150 characters of overlap, so that context isn't lost at chunk boundaries.

Every answer includes citations back to the exact source chunk it was generated from, including
the filename and page number when available, so a user can verify the answer against the original
document.
