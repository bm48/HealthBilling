import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/table-styles.css'

// Prevent InvalidCharacterError from createElement('') (e.g. from Handsontable column type or extension scripts)
const doc = document
const nativeCreateElement = doc.createElement.bind(doc)
doc.createElement = function createElement(tagName: string, options?: ElementCreationOptions): HTMLElement {
  const tag = typeof tagName === 'string' && tagName.trim() ? tagName : 'span'
  return nativeCreateElement(tag, options)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)
