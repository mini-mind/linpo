import { useState, useCallback } from 'react';
import type { InstanceItem, InstanceValidationResponse } from '../api/types';
import { validateInstance, createInstance, updateInstance } from '../api/instanceClient';

interface InstanceFormModalProps {
  instance?: InstanceItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormErrors {
  name?: string;
  endpoint?: string;
  gatewayToken?: string;
  general?: string;
}

export function InstanceFormModal({ instance, onClose, onSuccess }: InstanceFormModalProps): JSX.Element {
  const isEditing = !!instance;
  const [name, setName] = useState(instance?.name ?? '');
  const [endpoint, setEndpoint] = useState(instance?.endpoint ?? '');
  const [gatewayToken, setGatewayToken] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!name.trim()) {
      newErrors.name = '实例名称不能为空';
    }

    if (!endpoint.trim()) {
      newErrors.endpoint = '端点地址不能为空';
    } else {
      try {
        const url = new URL(endpoint);
        if (!['http:', 'https:'].includes(url.protocol)) {
          newErrors.endpoint = '端点地址必须以 http:// 或 https:// 开头';
        }
      } catch {
        newErrors.endpoint = '端点地址格式不正确';
      }
    }

    if (!isEditing && !gatewayToken.trim()) {
      newErrors.gatewayToken = 'Gateway Token 不能为空';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, endpoint, gatewayToken, isEditing]);

  const handleTestConnection = useCallback(async () => {
    if (!validateForm()) {
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    setErrors((prev) => ({ ...prev, general: undefined }));

    try {
      const validateResult: InstanceValidationResponse = await validateInstance({
        name,
        type: 'openclaw',
        endpoint,
        gatewayToken,
      });

      if (validateResult.ok) {
        setTestResult({ success: true, message: validateResult.message || '连接成功' });
      } else {
        setTestResult({ success: false, message: validateResult.message || '连接失败' });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : '测试连接失败',
      });
    } finally {
      setIsTesting(false);
    }
  }, [name, endpoint, gatewayToken, validateForm]);

  const handleSave = useCallback(async () => {
    if (!validateForm()) {
      return;
    }

    setIsSaving(true);
    setErrors((prev) => ({ ...prev, general: undefined }));

    try {
      if (isEditing && instance) {
        await updateInstance(instance.id, {
          name,
          endpoint,
          gatewayToken: gatewayToken || undefined,
        });
      } else {
        await createInstance({
          name,
          type: 'openclaw',
          endpoint,
          gatewayToken,
        });
      }

      onSuccess();
    } catch (error) {
      setIsSaving(false);
      setErrors({
        general: error instanceof Error ? error.message : '保存失败，请重试',
      });
    }
  }, [name, endpoint, gatewayToken, isEditing, instance, onSuccess, validateForm]);

  const handleOverlayClick = useCallback((e: React.MouseEvent): void => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  return (
    <div
      style={modalOverlayStyle}
      onClick={handleOverlayClick}
      role="presentation"
    >
      <div
        style={modalStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-modal-title"
      >
        <div style={modalHeaderStyle}>
          <h2 id="form-modal-title" style={modalTitleStyle}>
            {isEditing ? '编辑实例' : '添加实例'}
          </h2>
          <button type="button" style={closeButtonStyle} onClick={onClose} aria-label="关闭表单弹窗">
            ×
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
          style={formStyle}
        >
          <div style={fieldStyle}>
            <label htmlFor="instance-name" style={labelStyle}>
              实例名称
            </label>
            <input
              id="instance-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setTestResult(null);
              }}
              style={inputStyle}
              placeholder="输入实例名称"
              disabled={isTesting || isSaving}
            />
            {errors.name && <span style={errorTextStyle}>{errors.name}</span>}
          </div>

          <div style={fieldStyle}>
            <label htmlFor="instance-endpoint" style={labelStyle}>
              端点地址
            </label>
            <input
              id="instance-endpoint"
              type="text"
              value={endpoint}
              onChange={(e) => {
                setEndpoint(e.target.value);
                setTestResult(null);
              }}
              style={inputStyle}
              placeholder="http://127.0.0.1:28789"
              disabled={isTesting || isSaving}
            />
            {errors.endpoint && <span style={errorTextStyle}>{errors.endpoint}</span>}
          </div>

          <div style={fieldStyle}>
            <label htmlFor="instance-token" style={labelStyle}>
              Gateway Token
              {isEditing && <span style={optionalStyle}>（留空则保持现有 token）</span>}
            </label>
            <input
              id="instance-token"
              type="password"
              value={gatewayToken}
              onChange={(e) => {
                setGatewayToken(e.target.value);
                setTestResult(null);
              }}
              style={inputStyle}
              placeholder={isEditing ? '留空则保持不变' : '输入 Gateway Token'}
              disabled={isTesting || isSaving}
            />
            {!isEditing && errors.gatewayToken && <span style={errorTextStyle}>{errors.gatewayToken}</span>}
          </div>

          {testResult && (
            <div style={testResult.success ? testSuccessStyle : testErrorStyle}>
              <span style={testResult.success ? successTextStyle : errorTextStyle}>
                {testResult.message}
              </span>
            </div>
          )}

          {errors.general && (
            <div style={generalErrorStyle}>
              <span style={errorTextStyle}>{errors.general}</span>
            </div>
          )}

          <div style={modalFooterStyle}>
            <button type="button" style={cancelButtonStyle} onClick={onClose} disabled={isTesting || isSaving}>
              取消
            </button>
            <button
              type="button"
              style={testButtonStyle}
              onClick={() => void handleTestConnection()}
              disabled={isTesting || isSaving}
            >
              {isTesting ? '测试中...' : '测试连接'}
            </button>
            <button
              type="submit"
              style={saveButtonStyle}
              disabled={isTesting || isSaving}
            >
              {isSaving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 200,
};

const modalStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: '0.75rem',
  width: '90%',
  maxWidth: '480px',
  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  overflow: 'hidden',
};

const modalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '1rem 1.25rem',
  borderBottom: '1px solid #e5e7eb',
};

const modalTitleStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 600,
  color: '#1f2933',
  margin: 0,
};

const closeButtonStyle: React.CSSProperties = {
  width: '32px',
  height: '32px',
  borderRadius: '0.375rem',
  border: 'none',
  background: 'transparent',
  color: '#6b7280',
  fontSize: '1.5rem',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
};

const formStyle: React.CSSProperties = {
  padding: '1.25rem',
};

const fieldStyle: React.CSSProperties = {
  marginBottom: '1rem',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.875rem',
  fontWeight: 500,
  color: '#374151',
  marginBottom: '0.375rem',
};

const optionalStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#6b7280',
  fontWeight: 400,
  marginLeft: '0.25rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.625rem 0.875rem',
  border: '1px solid #d1d5db',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  color: '#1f2933',
  background: '#fff',
  boxSizing: 'border-box',
  outline: 'none',
};

const errorTextStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  color: '#dc2626',
  marginTop: '0.25rem',
};

const successTextStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  color: '#166534',
  marginTop: '0.25rem',
};

const generalErrorStyle: React.CSSProperties = {
  padding: '0.75rem',
  background: '#fef2f2',
  borderRadius: '0.5rem',
  marginBottom: '1rem',
};

const testSuccessStyle: React.CSSProperties = {
  padding: '0.75rem',
  background: '#dcfce7',
  borderRadius: '0.5rem',
  marginBottom: '1rem',
};

const testErrorStyle: React.CSSProperties = {
  padding: '0.75rem',
  background: '#fef2f2',
  borderRadius: '0.5rem',
  marginBottom: '1rem',
};

const modalFooterStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '0.75rem',
  paddingTop: '0.5rem',
};

const cancelButtonStyle: React.CSSProperties = {
  padding: '0.625rem 1rem',
  background: '#f3f4f6',
  color: '#374151',
  border: 'none',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  fontWeight: 500,
  cursor: 'pointer',
};

const testButtonStyle: React.CSSProperties = {
  padding: '0.625rem 1rem',
  background: '#f0fdf4',
  color: '#166534',
  border: '1px solid #bbf7d0',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  fontWeight: 500,
  cursor: 'pointer',
};

const saveButtonStyle: React.CSSProperties = {
  padding: '0.625rem 1.25rem',
  background: '#3b82f6',
  color: '#fff',
  border: 'none',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  fontWeight: 500,
  cursor: 'pointer',
};
