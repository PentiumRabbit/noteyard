import { useRef, useState } from "react";
import { Sidebar } from "./components/sidebar/Sidebar";
import { Editor, type EditorHandle } from "./components/editor/Editor";
import "./App.css";

export default function App() {
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const editorRef = useRef<EditorHandle>(null);

  const handleSelect = (id: string) => {
    // 切换页面前 flush 当前编辑器未保存内容
    editorRef.current?.flush();
    setSelectedPageId(id);
  };

  return (
    <div className="app">
      <Sidebar selectedId={selectedPageId} onSelect={handleSelect} />
      <main className="main">
        {selectedPageId ? (
          <Editor key={selectedPageId} ref={editorRef} pageId={selectedPageId} />
        ) : (
          <div className="empty-state">
            <p>Select a page or create one with the + button</p>
          </div>
        )}
      </main>
    </div>
  );
}
