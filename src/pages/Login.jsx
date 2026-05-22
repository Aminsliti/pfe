import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiUrl } from '../utils/api';
import { getHomePath } from '../utils/navigation';
import { 
  Container, 
  Row, 
  Col, 
  Card, 
  Form, 
  Button, 
  Alert,
  Modal,
  InputGroup
} from 'react-bootstrap';
import logo from '../assets/logo.png';
import logo2 from '../assets/logo2.png';

// v-bpm Logo Components
const VBPMLogo = ({ size = 60, className = "" }) => (
  <img 
    src={logo} 
    alt="v-bpm Logo" 
    width={size * 1.5} 
    height={size} 
    className={className}
    style={{ objectFit: 'contain' }}
  />
);

const VBPMLogo2 = ({ size = 60, className = "" }) => (
  <img 
    src={logo2} 
    alt="v-bpm Logo" 
    width={size * 1.5} 
    height={size} 
    className={className}
    style={{ objectFit: 'contain' }}
  />
);

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showResetPasswords, setShowResetPasswords] = useState(false);
  const [forgotPasswordData, setForgotPasswordData] = useState({
    email: '',
    code: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [forgotPasswordStep, setForgotPasswordStep] = useState(1); // 1: email, 2: code, 3: reset
  const [forgotPasswordError, setForgotPasswordError] = useState('');
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const getDestination = (result) => getHomePath(result?.user, result?.permissions);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(username, password);

      if (result.success) {
        navigate(getDestination(result), { replace: true });
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('An unexpected error occurred');
    }
    setLoading(false);
  };

  const openForgotPasswordModal = () => {
    setForgotPasswordData({
      email: '',
      code: '',
      newPassword: '',
      confirmPassword: ''
    });
    setForgotPasswordStep(1);
    setForgotPasswordError('');
    setShowResetPasswords(false);
    setShowForgotPassword(true);
  };

  const handleForgotPasswordChange = (e) => {
    const { name, value } = e.target;
    setForgotPasswordData(prev => ({ ...prev, [name]: value }));
  };

  const handleSendResetCode = async (e) => {
    e.preventDefault();
    setForgotPasswordError('');
    setForgotPasswordLoading(true);

    if (!forgotPasswordData.email) {
      setForgotPasswordError('Please enter your email address');
      setForgotPasswordLoading(false);
      return;
    }

    try {
      const response = await fetch(apiUrl('/forgot-password'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: forgotPasswordData.email }),
      });

      const data = await response.json();

      if (response.ok) {
        setForgotPasswordStep(2);
        setForgotPasswordError('');
      } else {
        setForgotPasswordError(data.error || 'Failed to send reset code');
      }
    } catch (error) {
      setForgotPasswordError('Network error. Please try again.');
    }
    setForgotPasswordLoading(false);
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    setForgotPasswordError('');
    setForgotPasswordLoading(true);

    if (!forgotPasswordData.code) {
      setForgotPasswordError('Please enter the verification code');
      setForgotPasswordLoading(false);
      return;
    }

    try {
      const response = await fetch(apiUrl('/verify-reset-code'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          email: forgotPasswordData.email, 
          code: forgotPasswordData.code 
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setForgotPasswordStep(3);
        setForgotPasswordError('');
      } else {
        setForgotPasswordError(data.error || 'Invalid verification code');
      }
    } catch (error) {
      setForgotPasswordError('Network error. Please try again.');
    }
    setForgotPasswordLoading(false);
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setForgotPasswordError('');
    setForgotPasswordLoading(true);

    if (!forgotPasswordData.newPassword || !forgotPasswordData.confirmPassword) {
      setForgotPasswordError('Please fill in all password fields');
      setForgotPasswordLoading(false);
      return;
    }

    if (forgotPasswordData.newPassword !== forgotPasswordData.confirmPassword) {
      setForgotPasswordError('Passwords do not match');
      setForgotPasswordLoading(false);
      return;
    }

    if (forgotPasswordData.newPassword.length < 6) {
      setForgotPasswordError('Password must be at least 6 characters long');
      setForgotPasswordLoading(false);
      return;
    }

    try {
      const response = await fetch(apiUrl('/reset-password'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          email: forgotPasswordData.email, 
          code: forgotPasswordData.code,
          newPassword: forgotPasswordData.newPassword 
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setShowForgotPassword(false);
        // Auto-login with new password
        const loginResult = await login(forgotPasswordData.email, forgotPasswordData.newPassword);
        if (loginResult.success) {
          navigate(getDestination(loginResult), { replace: true });
        }
      } else {
        setForgotPasswordError(data.error || 'Failed to reset password');
      }
    } catch (error) {
      setForgotPasswordError('Network error. Please try again.');
    }
    setForgotPasswordLoading(false);
  };

  return (
    <Container fluid className="min-vh-100" style={{ background: 'linear-gradient(135deg, #111827 0%, #374151 100%)' }}>
      <Row className="min-vh-100">
        <Col lg={6} className="d-none d-lg-flex align-items-center justify-content-center text-white">
          <div className="text-center px-4">
            <VBPMLogo2 size={180} className="mb-4" />
            <h1 className="display-4 fw-bold mb-3" style={{ color: '#dc2626', fontWeight: 700 }}>v-bpm</h1>
            <h2 className="h3 mb-3" style={{ color: '#f3f4f6', fontWeight: 500 }}>Business Process Management</h2>
            <p className="lead mb-4" style={{ color: '#9ca3af' }}>Enterprise Process Management & Automation Platform</p>
            <div className="d-flex justify-content-center gap-4">
              <div className="text-start">
                <h6 className="mb-3" style={{ color: '#e5e7eb' }}>Core Features:</h6>
                <ul className="list-unstyled">
                  <li className="mb-2"><i className="bi bi-check-circle-fill me-2" style={{ color: '#dc2626' }}></i><span style={{ color: '#d1d5db' }}>Process Management</span></li>
                  <li className="mb-2"><i className="bi bi-check-circle-fill me-2" style={{ color: '#dc2626' }}></i><span style={{ color: '#d1d5db' }}>Hierarchical Organization</span></li>
                  <li className="mb-2"><i className="bi bi-check-circle-fill me-2" style={{ color: '#dc2626' }}></i><span style={{ color: '#d1d5db' }}>BPMN Support</span></li>
                  <li className="mb-2"><i className="bi bi-check-circle-fill me-2" style={{ color: '#dc2626' }}></i><span style={{ color: '#d1d5db' }}>Role-Based Access</span></li>
                </ul>
              </div>
            </div>
          </div>
        </Col>

        <Col lg={6} className="d-flex align-items-center justify-content-center" style={{ background: '#f9fafb' }}>
          <div className="w-100" style={{ maxWidth: '450px' }}>
            <Card className="shadow-lg border-0" style={{ borderRadius: '12px', border: '1px solid #e5e7eb' }}>
              <Card.Body className="p-5">
                <div className="text-center mb-4">
                  <VBPMLogo size={90} className="mb-3" />
                  <h2 className="fw-bold" style={{ color: '#111827' }}>Welcome</h2>
                  <p className="text-muted" style={{ color: '#6b7280' }}>Sign in to continue to your account</p>
                </div>

                {error && (
                  <Alert variant="danger" className="mb-4" style={{ border: 'none', backgroundColor: '#fef2f2', color: '#dc2626' }}>
                    <i className="bi bi-exclamation-triangle me-2"></i>
                    {error}
                  </Alert>
                )}

                <Form onSubmit={handleSubmit}>
                  <Form.Group className="mb-3">
                    <Form.Label htmlFor="username" style={{ color: '#374151', fontWeight: 500 }}>Username or Email</Form.Label>
                    <Form.Control
                      type="text"
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      placeholder="Enter your username or email"
                      size="lg"
                      style={{ border: '1px solid #d1d5db', borderRadius: '6px' }}
                    />
                    
                  </Form.Group>

                  <Form.Group className="mb-4">
                    <Form.Label htmlFor="password" style={{ color: '#374151', fontWeight: 500 }}>Password</Form.Label>
                    <InputGroup size="lg">
                      <Form.Control
                        type={showLoginPassword ? 'text' : 'password'}
                        id="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        placeholder="Enter your password"
                        style={{ border: '1px solid #d1d5db', borderRadius: '6px 0 0 6px' }}
                      />
                      <Button
                        type="button"
                        variant="outline-secondary"
                        onClick={() => setShowLoginPassword((previous) => !previous)}
                        style={{ borderColor: '#d1d5db', color: '#374151' }}
                      >
                        <i className={`bi ${showLoginPassword ? 'bi-eye-slash' : 'bi-eye'}`}></i>
                      </Button>
                    </InputGroup>
                  </Form.Group>

                  <Button 
                    type="submit" 
                    size="lg" 
                    className="w-100 mb-4"
                    disabled={loading}
                    style={{ 
                      background: '#dc2626', 
                      border: 'none', 
                      borderRadius: '6px',
                      fontWeight: 500,
                      padding: '12px'
                    }}
                  >
                    {loading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                        Signing in...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-box-arrow-in-right me-2"></i>
                        Sign In
                      </>
                    )}
                  </Button>
                </Form>

                <Button
                  variant="outline-secondary"
                  className="w-100 mb-3"
                  onClick={() => navigate('/portal')}
                  style={{
                    borderRadius: '6px',
                    fontWeight: 500,
                    padding: '12px',
                  }}
                >
                  <i className="bi bi-globe2 me-2"></i>
                  Access public portal
                </Button>

                <div className="d-flex justify-content-start align-items-center mb-2">
                  <Button 
                    variant="link" 
                    className="p-0 text-decoration-none"
                    onClick={openForgotPasswordModal}
                    style={{ color: '#dc2626' }}
                  >
                    Forgot Password?
                  </Button>
                </div>
              </Card.Body>
            </Card>
          </div>
        </Col>
      </Row>

      {/* Forgot Password Modal */}
      <Modal show={showForgotPassword} onHide={() => setShowForgotPassword(false)} centered>
        <Modal.Header closeButton style={{ background: '#dc2626', color: 'white', border: 'none' }}>
          <Modal.Title className="fw-bold">
            <VBPMLogo size={45} className="me-2" />
            {forgotPasswordStep === 1 && 'Reset Password'}
            {forgotPasswordStep === 2 && 'Enter Verification Code'}
            {forgotPasswordStep === 3 && 'Set New Password'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {forgotPasswordError && (
            <Alert variant="danger" style={{ border: 'none', backgroundColor: '#fef2f2', color: '#dc2626' }}>
              <i className="bi bi-exclamation-triangle me-2"></i>
              {forgotPasswordError}
            </Alert>
          )}

          {forgotPasswordStep === 1 && (
            <Form onSubmit={handleSendResetCode}>
              <Form.Group className="mb-4">
                <Form.Label>Enter your email address</Form.Label>
                <Form.Control
                  type="email"
                  name="email"
                  value={forgotPasswordData.email}
                  onChange={handleForgotPasswordChange}
                  placeholder="Enter your registered email"
                  required
                />
                <Form.Text className="text-muted">
                  We'll send a verification code to this email address.
                </Form.Text>
              </Form.Group>

              <div className="d-flex justify-content-end gap-2">
                <Button variant="secondary" onClick={() => setShowForgotPassword(false)} style={{ background: '#6b7280', border: 'none' }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={forgotPasswordLoading} style={{ background: '#dc2626', border: 'none' }}>
                  {forgotPasswordLoading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                      Sending...
                    </>
                  ) : (
                      <>
                        <i className="bi bi-envelope me-2"></i>
                        Send Code
                      </>
                    )}
                </Button>
              </div>
            </Form>
          )}

          {forgotPasswordStep === 2 && (
            <Form onSubmit={handleVerifyCode}>
              <Alert variant="info" style={{ backgroundColor: '#f3f4f6', border: 'none', color: '#374151' }}>
                <i className="bi bi-info-circle me-2" style={{ color: '#dc2626' }}></i>
                A verification code has been sent to {forgotPasswordData.email}
              </Alert>
              
              <Form.Group className="mb-4">
                <Form.Label>Enter verification code</Form.Label>
                <Form.Control
                  type="text"
                  name="code"
                  value={forgotPasswordData.code}
                  onChange={handleForgotPasswordChange}
                  placeholder="Enter 6-digit code"
                  maxLength={6}
                  required
                />
                <Form.Text className="text-muted">
                  Check your email for the verification code.
                </Form.Text>
              </Form.Group>

              <div className="d-flex justify-content-between">
                <Button variant="outline-secondary" onClick={() => setForgotPasswordStep(1)}>
                  <i className="bi bi-arrow-left me-2"></i>
                  Back
                </Button>
                <div className="d-flex gap-2">
                  <Button variant="secondary" onClick={() => setShowForgotPassword(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" disabled={forgotPasswordLoading}>
                    {forgotPasswordLoading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                        Verifying...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-check-circle me-2"></i>
                        Verify Code
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </Form>
          )}

          {forgotPasswordStep === 3 && (
            <Form onSubmit={handleResetPassword}>
              <Form.Group className="mb-3">
                <Form.Label>New Password</Form.Label>
                <InputGroup>
                  <Form.Control
                    type={showResetPasswords ? 'text' : 'password'}
                    name="newPassword"
                    value={forgotPasswordData.newPassword}
                    onChange={handleForgotPasswordChange}
                    placeholder="Enter new password"
                    required
                    minLength={6}
                  />
                  <Button type="button" variant="outline-secondary" onClick={() => setShowResetPasswords((previous) => !previous)}>
                    <i className={`bi ${showResetPasswords ? 'bi-eye-slash' : 'bi-eye'}`}></i>
                  </Button>
                </InputGroup>
                <Form.Text className="text-muted">
                  Minimum 6 characters
                </Form.Text>
              </Form.Group>

              <Form.Group className="mb-4">
                <Form.Label>Confirm New Password</Form.Label>
                <InputGroup>
                  <Form.Control
                    type={showResetPasswords ? 'text' : 'password'}
                    name="confirmPassword"
                    value={forgotPasswordData.confirmPassword}
                    onChange={handleForgotPasswordChange}
                    placeholder="Confirm new password"
                    required
                  />
                  <Button type="button" variant="outline-secondary" onClick={() => setShowResetPasswords((previous) => !previous)}>
                    <i className={`bi ${showResetPasswords ? 'bi-eye-slash' : 'bi-eye'}`}></i>
                  </Button>
                </InputGroup>
              </Form.Group>

              <div className="d-flex justify-content-between">
                <Button variant="outline-secondary" onClick={() => setForgotPasswordStep(2)}>
                  <i className="bi bi-arrow-left me-2"></i>
                  Back
                </Button>
                <div className="d-flex gap-2">
                  <Button variant="secondary" onClick={() => setShowForgotPassword(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" disabled={forgotPasswordLoading}>
                    {forgotPasswordLoading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                        Resetting...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-key me-2"></i>
                        Reset Password
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </Form>
          )}
        </Modal.Body>
      </Modal>
    </Container>
  );
}

export default Login;
