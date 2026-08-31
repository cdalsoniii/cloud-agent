// Ontology Integration for SDLC Events
// Extends existing SDLC system with ChartDB-style relationship tracking

import { surrealQuery, surrealQueryResults } from './simple-surreal-client.js';
import { ValidationOrchestrator } from './validation/orchestrator.js';
import { OntologyNodeSchema, OntologyEdgeSchema } from './validation/schemas.js';

export class OntologyIntegrator {
  private validationOrchestrator: ValidationOrchestrator;
  private enableValidation: boolean = true;
  constructor(
    private surrealClient: { query: (sql: string) => Promise<any[]> } = { query: surrealQueryResults }
  ) {
    this.validationOrchestrator = new ValidationOrchestrator();
  }
  
  /**
   * Enable or disable validation hooks
   */
  setValidation(enabled: boolean): void {
    this.enableValidation = enabled;
  }
  
  /**
   * Validate ontology nodes before storage
   */
  async validateNodes(nodes: OntologyNode[]): Promise<{ valid: boolean; errors: any[] }> {
    const errors: any[] = [];
    
    for (const node of nodes) {
      const validation = await this.validationOrchestrator.validateEntity(node, 'node', node.namespace, node.database);
      if (!validation.valid) {
        errors.push({ node: node.node_id, errors: validation.message });
      }
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  /**
   * Validate ontology edges before storage
   */
  async validateEdges(edges: OntologyEdge[]): Promise<{ valid: boolean; errors: any[] }> {
    const errors: any[] = [];
    
    for (const edge of edges) {
      const validation = await this.validationOrchestrator.validateEntity(edge, 'edge', edge.namespace, edge.database);
      if (!validation.valid) {
        errors.push({ edge: edge.edge_id, errors: validation.message });
      }
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  /**
   * Query SurrealDB directly (useful for custom queries)
   */
  async query(sql: string): Promise<any[]> {
    return await this.surrealClient.query(sql);
  }

  /**
   * Track ontology elements for an SDLC event
   */
  async trackEventOntology(event: SDLCEvent): Promise<void> {
    try {
      // Validate the event itself
      if (this.enableValidation) {
        const eventValidation = await this.validationOrchestrator.validateEntity(event, 'node', event.ontology_namespace || 'main', event.ontology_database || 'main');
        if (!eventValidation.valid) {
          console.warn(`Event validation warnings for ${event.event_id}: ${eventValidation.message}`);
        }
      }
      
      // Extract ontology elements from event
      const nodes = this.extractNodesFromEvent(event);
      const edges = this.extractEdgesFromEvent(event);
      
      // Validate nodes before storage
      if (this.enableValidation && nodes.length > 0) {
        const nodeValidation = await this.validateNodes(nodes);
        if (!nodeValidation.valid) {
          console.warn(`Node validation failed for event ${event.event_id}:`, nodeValidation.errors);
          // Log but don't block - we can still store valid nodes
        }
      }
      
      // Validate edges before storage
      if (this.enableValidation && edges.length > 0) {
        const edgeValidation = await this.validateEdges(edges);
        if (!edgeValidation.valid) {
          console.warn(`Edge validation failed for event ${event.event_id}:`, edgeValidation.errors);
          // Log but don't block - we can still store valid edges
        }
      }
      
      // Store ontology relationships
      if (nodes.length > 0) {
        await this.storeOntologyNodes(nodes, event);
        await this.updateEventWithNodes(event.event_id, nodes);
      }
      
      if (edges.length > 0) {
        await this.storeOntologyEdges(edges, event);
        await this.updateEventWithEdges(event.event_id, edges);
      }
      
      // Apply ontology rules to this event
      const ruleResults = await this.applyRulesToEvent(event);
      if (ruleResults.length > 0) {
        await this.updateEventWithRules(event.event_id, ruleResults);
      }
      
      console.log(`Ontology tracking completed for event ${event.event_id}: ${nodes.length} nodes, ${edges.length} edges, ${ruleResults.length} rules`);
      
    } catch (error) {
      console.error(`Failed to track ontology for event ${event.event_id}:`, error);
      // Don't throw - ontology tracking should not break main event logging
    }
  }
  
  /**
   * Extract ontology nodes from SDLC event
   */
  private extractNodesFromEvent(event: SDLCEvent): OntologyNode[] {
    const nodes: OntologyNode[] = [];
    
    // Event type node
    nodes.push({
      node_id: `event_type_${event.event_type}`,
      node_type: 'sdlc_event_type',
      name: event.event_type,
      description: `SDLC event type: ${event.event_type}`,
      properties: { phase: event.phase },
      namespace: event.ontology_namespace || 'main',
      database: event.ontology_database || 'main'
    });
    
    // Phase node
    if (event.phase) {
      nodes.push({
        node_id: `phase_${event.phase}`,
        node_type: 'sdlc_phase',
        name: event.phase,
        description: `SDLC phase: ${event.phase}`,
        properties: {},
        namespace: event.ontology_namespace || 'main',
        database: event.ontology_database || 'main'
      });
    }
    
    // Repository node
    if (event.repo_target) {
      nodes.push({
        node_id: `repo_${this.sanitizeId(event.repo_target)}`,
        node_type: 'repository',
        name: event.repo_target,
        description: `Target repository: ${event.repo_target}`,
        properties: {},
        namespace: event.ontology_namespace || 'main',
        database: event.ontology_database || 'main'
      });
    }
    
    // Model node
    if (event.model_id) {
      nodes.push({
        node_id: `model_${this.sanitizeId(event.model_id)}`,
        node_type: 'ai_model',
        name: event.model_id,
        description: `AI model: ${event.model_id}`,
        properties: { provider: event.model_provider },
        namespace: event.ontology_namespace || 'main',
        database: event.ontology_database || 'main'
      });
    }
    
    // Sandbox node
    if (event.sandbox_id) {
      nodes.push({
        node_id: `sandbox_${this.sanitizeId(event.sandbox_id)}`,
        node_type: 'sandbox',
        name: event.sandbox_id,
        description: `Execution sandbox: ${event.sandbox_id}`,
        properties: {},
        namespace: event.ontology_namespace || 'main',
        database: event.ontology_database || 'main'
      });
    }
    
    return nodes;
  }
  
  /**
   * Extract ontology edges from SDLC event
   */
  private extractEdgesFromEvent(event: SDLCEvent): OntologyEdge[] {
    const edges: OntologyEdge[] = [];
    const namespace = event.ontology_namespace || 'main';
    const database = event.ontology_database || 'main';
    
    // Event -> Phase relationship
    if (event.phase) {
      edges.push({
        edge_id: `rel_${event.event_id}_phase`,
        source_id: `event_type_${event.event_type}`,
        target_id: `phase_${event.phase}`,
        relationship_type: 'occurs_in',
        weight: 1.0,
        properties: { event_id: event.event_id },
        namespace,
        database
      });
    }
    
    // Event -> Repository relationship
    if (event.repo_target) {
      edges.push({
        edge_id: `rel_${event.event_id}_repo`,
        source_id: `event_type_${event.event_type}`,
        target_id: `repo_${this.sanitizeId(event.repo_target)}`,
        relationship_type: 'targets',
        weight: 1.0,
        properties: { event_id: event.event_id },
        namespace,
        database
      });
    }
    
    // Event -> Model relationship
    if (event.model_id) {
      edges.push({
        edge_id: `rel_${event.event_id}_model`,
        source_id: `event_type_${event.event_type}`,
        target_id: `model_${this.sanitizeId(event.model_id)}`,
        relationship_type: 'uses',
        weight: event.cost_usd ? Math.log(event.cost_usd + 1) : 1.0,
        properties: { 
          event_id: event.event_id,
          tokens_in: event.tokens_in,
          tokens_out: event.tokens_out,
          cost_usd: event.cost_usd
        },
        namespace,
        database
      });
    }
    
    // Phase flow relationships (if we have multiple events)
    if (event.phase && event.parent_event_id) {
      // This would require fetching the parent event to determine phase flow
      // For now, we'll create a generic "follows" relationship
      edges.push({
        edge_id: `rel_${event.parent_event_id}_to_${event.event_id}`,
        source_id: event.parent_event_id,
        target_id: event.event_id,
        relationship_type: 'follows',
        weight: 1.0,
        properties: { 
          parent_event: event.parent_event_id,
          child_event: event.event_id 
        },
        namespace,
        database
      });
    }
    
    return edges;
  }
  
  /**
   * Store ontology nodes in SurrealDB
   */
  private async storeOntologyNodes(nodes: OntologyNode[], event: SDLCEvent): Promise<void> {
    for (const node of nodes) {
      try {
        const query = `CREATE ontology_node CONTENT ${JSON.stringify(node)}`;
        await this.surrealClient.query(query);
      } catch (error) {
        console.error(`Failed to store ontology node ${node.node_id}:`, error);
      }
    }
  }
  
  /**
   * Store ontology edges in SurrealDB
   */
  private async storeOntologyEdges(edges: OntologyEdge[], event: SDLCEvent): Promise<void> {
    for (const edge of edges) {
      try {
        const query = `CREATE ontology_edge CONTENT ${JSON.stringify(edge)}`;
        await this.surrealClient.query(query);
      } catch (error) {
        console.error(`Failed to store ontology edge ${edge.edge_id}:`, error);
      }
    }
  }
  
  /**
   * Apply ontology rules to SDLC event
   */
  private async applyRulesToEvent(event: SDLCEvent): Promise<any[]> {
    const results: any[] = [];
    const namespace = event.ontology_namespace || 'main';
    const database = event.ontology_database || 'main';
    
    try {
      // Get rules that apply to this event type
      const rulesQuery = `SELECT * FROM ontology_rule 
                         WHERE namespace = "${namespace}" 
                         AND database = "${database}" 
                         AND enabled = true
                         AND "sdlc_event" IN applies_to`;
      
      const rules = await this.surrealClient.query(rulesQuery);
      
      for (const rule of rules) {
        try {
          // Execute rule condition with event context
          const conditionWithContext = rule.rule_condition.replace(
            '$event', 
            JSON.stringify(event)
          );
          
          const conditionResult = await this.surrealClient.query(conditionWithContext);
          
          if (conditionResult && conditionResult.length > 0) {
            // Condition met, execute action
            const actionResult = await this.surrealClient.query(rule.rule_action);
            
            results.push({
              rule_id: rule.rule_id,
              rule_type: rule.rule_type,
              condition_result: conditionResult,
              action_result: actionResult,
              applied_at: new Date().toISOString()
            });
          }
        } catch (error: any) {
          console.error(`Error applying rule ${rule.rule_id}:`, error);
          results.push({
            rule_id: rule.rule_id,
            error: error.message,
            failed_at: new Date().toISOString()
          });
        }
      }
    } catch (error: any) {
      console.error('Failed to apply rules:', error);
    }
    
    return results;
  }
  
  /**
   * Update event with ontology nodes
   */
  private async updateEventWithNodes(eventId: string, nodes: OntologyNode[]): Promise<void> {
    const nodeIds = nodes.map(node => node.node_id);
    const query = `UPDATE sdlc_event:${eventId} SET ontology_nodes = ${JSON.stringify(nodeIds)}`;
    await this.surrealClient.query(query);
  }
  
  /**
   * Update event with ontology edges
   */
  private async updateEventWithEdges(eventId: string, edges: OntologyEdge[]): Promise<void> {
    const edgeIds = edges.map(edge => edge.edge_id);
    const query = `UPDATE sdlc_event:${eventId} SET ontology_edges = ${JSON.stringify(edgeIds)}`;
    await this.surrealClient.query(query);
  }
  
  /**
   * Update event with applied rules
   */
  private async updateEventWithRules(eventId: string, ruleResults: any[]): Promise<void> {
    const query = `UPDATE sdlc_event:${eventId} SET ontology_rules_applied = ${JSON.stringify(ruleResults)}`;
    await this.surrealClient.query(query);
  }
  
  /**
   * Sanitize ID for use in node IDs
   */
  private sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_');
  }
  
  /**
   * Query ontology graph for insights
   * Uses application-level joins since SurrealDB doesn't support SQL JOINs
   */
  async queryOntologyGraph(queryType: 'event_flow' | 'model_usage' | 'phase_analysis', filters: any = {}): Promise<any> {
    const namespace = filters.namespace || 'main';
    const database = filters.database || 'main';
    
    let results: any[] = [];
    
    switch (queryType) {
      case 'event_flow': {
        // Get all edges
        const edges = await this.surrealClient.query(`
          SELECT * FROM ontology_edge 
          WHERE namespace = "${namespace}" AND database = "${database}"
          ORDER BY weight DESC
        `);
        
        // Get all nodes referenced by these edges
        const nodeIds = [...new Set([
          ...edges.map((e: any) => e.source_id),
          ...edges.map((e: any) => e.target_id)
        ])];
        
        if (nodeIds.length > 0) {
          const nodes = await this.surrealClient.query(`
            SELECT * FROM ontology_node 
            WHERE node_id IN ${JSON.stringify(nodeIds)}
            AND namespace = "${namespace}" AND database = "${database}"
          `);
          
          const nodeMap = new Map(nodes.map((n: any) => [n.node_id, n]));
          
          results = edges.map((edge: any) => ({
            ...edge,
            source_name: nodeMap.get(edge.source_id)?.name,
            source_type: nodeMap.get(edge.source_id)?.node_type,
            target_name: nodeMap.get(edge.target_id)?.name,
            target_type: nodeMap.get(edge.target_id)?.node_type
          }));
        }
        break;
      }
        
      case 'model_usage': {
        // Get all models
        const models = await this.surrealClient.query(`
          SELECT * FROM ontology_node 
          WHERE node_type = 'ai_model' 
          AND namespace = "${namespace}" AND database = "${database}"
          ORDER BY created_at DESC
        `);
        
        // For each model, get usage statistics
        for (const model of models) {
          const edges = await this.surrealClient.query(`
            SELECT * FROM ontology_edge 
            WHERE target_id = "${model.node_id}"
            AND namespace = "${namespace}" AND database = "${database}"
          `);
          
          const usageCount = edges.length;
          const totalCost = edges.reduce((sum: number, e: any) => sum + (e.properties?.cost_usd || 0), 0);
          const avgWeight = edges.length > 0 
            ? edges.reduce((sum: number, e: any) => sum + (e.weight || 1), 0) / edges.length 
            : 0;
          
          results.push({
            model_name: model.name,
            model_id: model.node_id,
            usage_count: usageCount,
            total_cost: totalCost,
            avg_weight: avgWeight
          });
        }
        break;
      }
        
      case 'phase_analysis': {
        // Get all phases
        const phases = await this.surrealClient.query(`
          SELECT * FROM ontology_node 
          WHERE node_type = 'sdlc_phase' 
          AND namespace = "${namespace}" AND database = "${database}"
          ORDER BY created_at DESC
        `);
        
        // For each phase, get event statistics
        for (const phase of phases) {
          const edges = await this.surrealClient.query(`
            SELECT * FROM ontology_edge 
            WHERE target_id = "${phase.node_id}"
            AND namespace = "${namespace}" AND database = "${database}"
          `);
          
          const eventEdges = edges.filter((e: any) => e.source_id?.startsWith('event_type_'));
          const tokensIn = eventEdges.map((e: any) => e.properties?.tokens_in || 0).filter((v: number) => v > 0);
          const tokensOut = eventEdges.map((e: any) => e.properties?.tokens_out || 0).filter((v: number) => v > 0);
          const costs = eventEdges.map((e: any) => e.properties?.cost_usd || 0).filter((v: number) => v > 0);
          
          const avgTokensIn = tokensIn.length > 0 ? tokensIn.reduce((a: number, b: number) => a + b, 0) / tokensIn.length : 0;
          const avgTokensOut = tokensOut.length > 0 ? tokensOut.reduce((a: number, b: number) => a + b, 0) / tokensOut.length : 0;
          const avgCost = costs.length > 0 ? costs.reduce((a: number, b: number) => a + b, 0) / costs.length : 0;
          
          results.push({
            phase_name: phase.name,
            phase_id: phase.node_id,
            event_count: eventEdges.length,
            avg_tokens_in: avgTokensIn,
            avg_tokens_out: avgTokensOut,
            avg_cost: avgCost
          });
        }
        break;
      }
        
      default:
        throw new Error(`Unknown query type: ${queryType}`);
    }
    
    return results;
  }
}

// Type definitions for ontology elements
interface OntologyNode {
  node_id: string;
  node_type: string;
  name: string;
  description: string;
  properties?: any;
  namespace: string;
  database: string;
}

interface OntologyEdge {
  edge_id: string;
  source_id: string;
  target_id: string;
  relationship_type: string;
  weight: number;
  properties?: any;
  namespace: string;
  database: string;
}

interface SDLCEvent {
  event_id: string;
  event_type: string;
  phase?: string;
  repo_target?: string;
  model_id?: string;
  model_provider?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  sandbox_id?: string;
  parent_event_id?: string;
  ontology_namespace?: string;
  ontology_database?: string;
  // ... other SDLC event fields
}

// Export singleton instance
export const ontologyIntegrator = new OntologyIntegrator();

// Utility function to integrate with existing event logger
export function integrateWithEventLogger() {
  // This would patch the existing event logger to automatically call ontology tracking
  // Implementation depends on your existing event logging structure
  console.log('Ontology integration ready for SDLC events');
}