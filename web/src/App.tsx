import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import ContactsPanel from './components/ContactsPanel';
import ChatPanel from './components/ChatPanel';
import Dashboard from './pages/Dashboard';
import Contacts from './pages/Contacts';
import ContactDetail from './pages/ContactDetail';
import Groups from './pages/Groups';
import Captures from './pages/Captures';
import Sweep from './pages/Sweep';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <Sidebar />
        <ContactsPanel />
        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/contacts/:id" element={<ContactDetail />} />
            <Route path="/groups" element={<Groups />} />
            <Route path="/captures" element={<Captures />} />
            <Route path="/sweep" element={<Sweep />} />
          </Routes>
        </main>
        <ChatPanel />
      </div>
    </BrowserRouter>
  );
}
