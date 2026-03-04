import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  Container, 
  Row, 
  Col, 
  Card, 
  Form, 
  Button, 
  Alert,
  Badge,
  Modal
} from 'react-bootstrap';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [signUpData, setSignUpData] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    email: '',
    fullName: ''
  });
  const [forgotPasswordData, setForgotPasswordData] = useState({
    email: '',
    code: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [forgotPasswordStep, setForgotPasswordStep] = useState(1); // 1: email, 2: code, 3: reset
  const [signUpError, setSignUpError] = useState('');
  const [forgotPasswordError, setForgotPasswordError] = useState('');
  const [signUpLoading, setSignUpLoading] = useState(false);
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const { login, createUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/dashboard';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(username, password);

      if (result.success) {
        navigate(from, { replace: true });
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('An unexpected error occurred');
    }
    setLoading(false);
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setSignUpError('');
    setSignUpLoading(true);

    // Validation
    if (!signUpData.username || !signUpData.password || !signUpData.email || !signUpData.fullName) {
      setSignUpError('Please fill in all fields');
      setSignUpLoading(false);
      return;
    }

    if (signUpData.password !== signUpData.confirmPassword) {
      setSignUpError('Passwords do not match');
      setSignUpLoading(false);
      return;
    }

    if (signUpData.password.length < 6) {
      setSignUpError('Password must be at least 6 characters long');
      setSignUpLoading(false);
      return;
    }

    try {
      const result = await createUser({
        username: signUpData.username,
        password: signUpData.password,
        email: signUpData.email,
        fullName: signUpData.fullName,
        role: 'Viewer' // Default role
      });

      if (result.success) {
        // Auto-login after successful registration
        const loginResult = await login(signUpData.username, signUpData.password);
        if (loginResult.success) {
          navigate(from, { replace: true });
        } else {
          setSignUpError('Account created but login failed. Please try logging in.');
        }
      } else {
        setSignUpError(result.error);
      }
    } catch (err) {
      setSignUpError('An unexpected error occurred during registration');
    }
    setSignUpLoading(false);
  };

  const handleSignUpChange = (e) => {
    const { name, value } = e.target;
    setSignUpData(prev => ({ ...prev, [name]: value }));
  };

  const openSignUpModal = () => {
    setSignUpData({
      username: '',
      password: '',
      confirmPassword: '',
      email: '',
      fullName: ''
    });
    setSignUpError('');
    setShowSignUp(true);
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
      const response = await fetch('http://localhost:3001/api/forgot-password', {
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
      const response = await fetch('http://localhost:3001/api/verify-reset-code', {
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
      const response = await fetch('http://localhost:3001/api/reset-password', {
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
          navigate(from, { replace: true });
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
    <Container fluid className="min-vh-100 bg-light">
      <Row className="min-vh-100">
        <Col lg={6} className="d-none d-lg-flex align-items-center justify-content-center bg-primary text-white">
          <div className="text-center">
            <i className="bi bi-shield-fill-check display-1 mb-4"></i>
            <h1 className="display-4 fw-bold mb-3">PFE Platform</h1>
            <p className="lead mb-4">Enterprise Role-Based Access Control System</p>
            <div className="d-flex justify-content-center gap-3">
              <div className="text-start">
                <h6>Features:</h6>
                <ul className="list-unstyled">
                  <li><i className="bi bi-check-circle me-2"></i>User Management</li>
                  <li><i className="bi bi-check-circle me-2"></i>Role Management</li>
                  <li><i className="bi bi-check-circle me-2"></i>Permission Control</li>
                  <li><i className="bi bi-check-circle me-2"></i>Secure Authentication</li>
                </ul>
              </div>
            </div>
          </div>
        </Col>

        <Col lg={6} className="d-flex align-items-center justify-content-center">
          <div className="w-100" style={{ maxWidth: '450px' }}>
            <Card className="shadow-lg border-0">
              <Card.Body className="p-5">
                <div className="text-center mb-4">
                  <i className="bi bi-shield-fill-check text-primary display-4 mb-3"></i>
                  <h2>Welcome Back</h2>
                  <p className="text-muted">Sign in to continue to your account</p>
                </div>

                {error && (
                  <Alert variant="danger" className="mb-4">
                    <i className="bi bi-exclamation-triangle me-2"></i>
                    {error}
                  </Alert>
                )}

                <Form onSubmit={handleSubmit}>
                  <Form.Group className="mb-3">
                    <Form.Label htmlFor="username">Username or Email</Form.Label>
                    <Form.Control
                      type="text"
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      placeholder="Enter your username or email"
                      size="lg"
                    />
                    <Form.Text className="text-muted">
                      Try: admin / admin123 OR admin@pfe.com / admin123
                    </Form.Text>
                  </Form.Group>

                  <Form.Group className="mb-4">
                    <Form.Label htmlFor="password">Password</Form.Label>
                    <Form.Control
                      type="password"
                      id="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="Enter your password"
                      size="lg"
                    />
                  </Form.Group>

                  <Button 
                    type="submit" 
                    variant="primary" 
                    size="lg" 
                    className="w-100 mb-4"
                    disabled={loading}
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

                <div className="d-flex justify-content-between align-items-center mb-4">
                  <Button 
                    variant="link" 
                    className="p-0 text-decoration-none"
                    onClick={openForgotPasswordModal}
                  >
                    Forgot Password?
                  </Button>
                  <Button 
                    variant="outline-primary" 
                    size="sm"
                    onClick={openSignUpModal}
                  >
                    <i className="bi bi-person-plus me-2"></i>
                    Sign Up
                  </Button>
                </div>

                <div className="text-center">
                  <p className="text-muted mb-0">
                    Don't have an account? 
                    <Button 
                      variant="link" 
                      className="p-0 ms-1 text-decoration-none"
                      onClick={openSignUpModal}
                    >
                      Sign up here
                    </Button>
                  </p>
                </div>
              </Card.Body>
            </Card>
          </div>
        </Col>
      </Row>

      {/* Sign Up Modal */}
      <Modal show={showSignUp} onHide={() => setShowSignUp(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            <i className="bi bi-person-plus me-2"></i>
            Create New Account
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {signUpError && (
            <Alert variant="danger">
              <i className="bi bi-exclamation-triangle me-2"></i>
              {signUpError}
            </Alert>
          )}

          <Form onSubmit={handleSignUp}>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Full Name *</Form.Label>
                  <Form.Control
                    type="text"
                    name="fullName"
                    value={signUpData.fullName}
                    onChange={handleSignUpChange}
                    placeholder="Enter your full name"
                    required
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Username *</Form.Label>
                  <Form.Control
                    type="text"
                    name="username"
                    value={signUpData.username}
                    onChange={handleSignUpChange}
                    placeholder="Choose a username"
                    required
                  />
                </Form.Group>
              </Col>
            </Row>

            <Form.Group className="mb-3">
              <Form.Label>Email *</Form.Label>
              <Form.Control
                type="email"
                name="email"
                value={signUpData.email}
                onChange={handleSignUpChange}
                placeholder="Enter your email"
                required
              />
            </Form.Group>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Password *</Form.Label>
                  <Form.Control
                    type="password"
                    name="password"
                    value={signUpData.password}
                    onChange={handleSignUpChange}
                    placeholder="Create a password"
                    required
                    minLength={6}
                  />
                  <Form.Text className="text-muted">
                    Minimum 6 characters
                  </Form.Text>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Confirm Password *</Form.Label>
                  <Form.Control
                    type="password"
                    name="confirmPassword"
                    value={signUpData.confirmPassword}
                    onChange={handleSignUpChange}
                    placeholder="Confirm your password"
                    required
                  />
                </Form.Group>
              </Col>
            </Row>

            <div className="d-flex justify-content-end gap-2">
              <Button variant="secondary" onClick={() => setShowSignUp(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={signUpLoading}>
                {signUpLoading ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                    Creating Account...
                  </>
                ) : (
                  <>
                    <i className="bi bi-person-plus me-2"></i>
                    Sign Up
                  </>
                )}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>

      {/* Forgot Password Modal */}
      <Modal show={showForgotPassword} onHide={() => setShowForgotPassword(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            <i className="bi bi-key me-2"></i>
            {forgotPasswordStep === 1 && 'Reset Password'}
            {forgotPasswordStep === 2 && 'Enter Verification Code'}
            {forgotPasswordStep === 3 && 'Set New Password'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {forgotPasswordError && (
            <Alert variant="danger">
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
                <Button variant="secondary" onClick={() => setShowForgotPassword(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={forgotPasswordLoading}>
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
              <Alert variant="info">
                <i className="bi bi-info-circle me-2"></i>
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
                <Form.Control
                  type="password"
                  name="newPassword"
                  value={forgotPasswordData.newPassword}
                  onChange={handleForgotPasswordChange}
                  placeholder="Enter new password"
                  required
                  minLength={6}
                />
                <Form.Text className="text-muted">
                  Minimum 6 characters
                </Form.Text>
              </Form.Group>

              <Form.Group className="mb-4">
                <Form.Label>Confirm New Password</Form.Label>
                <Form.Control
                  type="password"
                  name="confirmPassword"
                  value={forgotPasswordData.confirmPassword}
                  onChange={handleForgotPasswordChange}
                  placeholder="Confirm new password"
                  required
                />
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
