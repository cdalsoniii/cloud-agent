'use client';

import { useState, useEffect } from 'react';

interface VerificationPanelProps {
  mcpDefinition: unknown;
}

interface DafnyVerifyResult {
  verified: boolean;
  errors: Array<{ line: number; message: string }>;
  counterexamples?: unknown[];
}

interface MidspiralVerifyResult {
  verified: boolean;
  coverage: number;
  matched: string[];
  missing: string[];
}

export default function VerificationPanel({ mcpDefinition }: VerificationPanelProps) {
  const [dafnyResult, setDafnyResult] = useState<DafnyVerifyResult | null>(null);
  const [midspiralResult, setMidspiralResult] = useState<MidspiralVerifyResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!mcpDefinition) return;

    const verifyMcp = async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ mcpDefinition }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        setDafnyResult(data.dafny);
        setMidspiralResult(data.midspiral);
      } catch (error) {
        console.error('Failed to verify MCP:', error);
        setDafnyResult({ verified: false, errors: [{ line: 0, message: 'Verification failed' }] });
        setMidspiralResult({ verified: false, coverage: 0, matched: [], missing: ['Verification failed'] });
      } finally {
        setLoading(false);
      }
    };

    verifyMcp();
  }, [mcpDefinition]);

  const getStatusIcon = (verified: boolean) => {
    return verified ? (
      <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    ) : (
      <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    );
  };

  const getCoverageColor = (coverage: number) => {
    if (coverage >= 80) return 'bg-green-500';
    if (coverage >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-semibold mb-4">Verification Results</h2>
      
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600">Verifying...</span>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Dafny Verification Section */}
          <div>
            <h3 className="text-lg font-medium mb-3">Dafny Formal Verification</h3>
            {dafnyResult ? (
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  {getStatusIcon(dafnyResult.verified)}
                  <span 
                    data-testid="dafny-verified"
                    className={`font-medium ${dafnyResult.verified ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {dafnyResult.verified ? 'Verified' : 'Failed'}
                  </span>
                </div>
                
                {dafnyResult.errors.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3">
                    <h4 className="font-medium text-red-800 mb-2">Errors:</h4>
                    <ul className="text-sm text-red-700 space-y-1">
                      {dafnyResult.errors.map((error, index) => (
                        <li key={index}>
                          Line {error.line}: {error.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500">No Dafny verification results available</p>
            )}
          </div>

          {/* Midspiral Verification Section */}
          <div>
            <h3 className="text-lg font-medium mb-3">Midspiral Runtime Verification</h3>
            {midspiralResult ? (
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  {getStatusIcon(midspiralResult.verified)}
                  <span 
                    data-testid="midspiral-verified"
                    className={`font-medium ${midspiralResult.verified ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {midspiralResult.verified ? 'Verified' : 'Failed'}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Coverage:</span>
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${getCoverageColor(midspiralResult.coverage)}`}
                        style={{ width: `${midspiralResult.coverage}%` }}
                      />
                    </div>
                    <span className="text-sm text-gray-600">{midspiralResult.coverage}%</span>
                  </div>

                  {midspiralResult.matched.length > 0 && (
                    <div className="bg-green-50 border border-green-200 rounded-md p-3">
                      <h4 className="font-medium text-green-800 mb-2">Matched Rules:</h4>
                      <ul className="text-sm text-green-700 space-y-1">
                        {midspiralResult.matched.map((rule, index) => (
                          <li key={index}>{rule}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {midspiralResult.missing.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-md p-3">
                      <h4 className="font-medium text-red-800 mb-2">Missing Rules:</h4>
                      <ul className="text-sm text-red-700 space-y-1">
                        {midspiralResult.missing.map((rule, index) => (
                          <li key={index}>{rule}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-gray-500">No Midspiral verification results available</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}