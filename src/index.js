import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import './index.css';
import AuthProvider from './contexts/AuthProvider';

ReactDOM.render(
  <AuthProvider>
    <App />
  </AuthProvider>,
  document.getElementById('root')
);
