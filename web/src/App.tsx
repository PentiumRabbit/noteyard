import { useState } from "react";
import { Sidebar } from "./components/sidebar/Sidebar";
import { Editor } from "./components/editor/Editor";
import "./App.css";

export default function App() {
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);

  return (
    <div className="app">
      <Sidebar selectedId={selectedPageId} onSelect={setSelectedPageId} />
      <main className="main">
        {selectedPageId ? (
          <Editor key={selectedPageId} pageId={selectedPageId} />
        ) : (
          <div className="empty-state">
            <p>Select a page or create one with the + button</p>
          </div>
        )}
      </main>
    </div>
  );
}
