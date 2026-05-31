import { NavLink } from 'react-router-dom';
import styles from './Sidebar.module.css';

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/contacts', label: 'Contacts' },
  { to: '/groups', label: 'Groups' },
  { to: '/captures', label: 'Captures' },
  { to: '/sweep', label: 'Sweep' },
  { to: '/chat', label: 'Chat' },
];

export default function Sidebar() {
  return (
    <nav className={styles.sidebar}>
      <div className={styles.title}>Kit</div>
      {links.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `${styles.link} ${isActive ? styles.active : ''}`
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
