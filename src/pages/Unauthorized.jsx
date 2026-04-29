import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getHomePath } from '../utils/navigation';
import './Unauthorized.css';

export function Unauthorized() {
  const navigate = useNavigate();
  const { user, permissions } = useAuth();
  const homePath = getHomePath(user, permissions);

  return (
    <div className="unauthorized">
      <div className="unauthorized-content">
        <h1>403</h1>
        <h2>Access Denied</h2>
        <p>You do not have permission to access this page.</p>
        <p>Please contact your administrator if you believe this is an error.</p>
        <button onClick={() => navigate(-1)} className="back-button">
          Go Back
        </button>
        <button onClick={() => navigate(homePath)} className="home-button">
          Go to Home
        </button>
      </div>
    </div>
  );
}

export default Unauthorized;
