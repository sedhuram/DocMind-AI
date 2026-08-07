# DocMind AI - Frequently Asked Questions

**What file types are supported?**
PDF, TXT, Markdown, and DOCX files can be uploaded or placed in the static ingestion directory.

**How does DocMind AI decide when it doesn't know an answer?**
Every retrieval computes a similarity score between the question and the closest matching chunks.
If the best match falls below a configured confidence threshold, the system still shows what it
found but instructs the model to say plainly that it doesn't have enough information, rather than
guessing.

**Is my data sent anywhere other than the Gemini API?**
No. Documents and their embeddings are stored locally — SQLite for metadata and chat history,
ChromaDB in persistent file mode for vectors. The only outbound calls are to the Gemini API for
embedding and generation.
