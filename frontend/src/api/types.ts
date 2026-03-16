/**
 * API types matching backend schemas from app/api/schemas.py
 * These types correspond to the backend Pydantic models
 */

export type AgentStatus = 'idle' | 'running' | 'finished' | 'error';

export type EventType =
  | 'agent_created'
  | 'subagent_created'
  | 'activity_started'
  | 'activity_stopped'
  | 'status_changed'
  | 'node_finished'
  | 'task_started'
  | 'task_finished'
  | 'task_interrupted';

/**
 * Agent list item - used in GET /agents response
 */
export interface AgentListItem {
  id: string;
  name: string;
  status: AgentStatus;
  is_active: boolean;
  last_active_at: string | null;
}

/**
 * Topology node - part of agent detail response
 */
export interface TopologyNode {
  id: string;
  name: string;
  status: AgentStatus;
  is_active: boolean;
  child_count: number;
  parent_id: string | null;
}

/**
 * Agent detail response - GET /agents/{agent_id}
 */
export interface AgentDetailResponse {
  id: string;
  name: string;
  status: AgentStatus;
  is_active: boolean;
  root_node_id: string;
  root_child_count: number;
  total_node_count: number;
  last_active_at: string | null;
  nodes: TopologyNode[];
}

/**
 * Event record item - part of node detail response
 */
export interface EventRecord {
  id: string;
  node_id: string;
  type: EventType;
  timestamp: string;
  description: string;
}

/**
 * Node detail response - GET /agents/{agent_id}/nodes/{node_id}
 */
export interface NodeDetailResponse {
  id: string;
  name: string;
  status: AgentStatus;
  is_active: boolean;
  last_active_started_at: string | null;
  events: EventRecord[];
}
