/// <reference types="jest" />
/**
 * Unit tests for CollapsibleSidebar component
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CollapsibleSidebar from '../../app/components/CollapsibleSidebar';

describe('CollapsibleSidebar', () => {
  it('renders in expanded state by default', () => {
    render(
      <CollapsibleSidebar title="Test Sidebar">
        <div data-testid="content">Sidebar Content</div>
      </CollapsibleSidebar>
    );

    expect(screen.getByText('Test Sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('renders in collapsed state when defaultCollapsed is true', () => {
    render(
      <CollapsibleSidebar title="Test Sidebar" defaultCollapsed={true}>
        <div data-testid="content">Sidebar Content</div>
      </CollapsibleSidebar>
    );

    // Title should not be visible when collapsed
    expect(screen.queryByText('Test Sidebar')).not.toBeInTheDocument();
    // Content should not be visible when collapsed
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });

  it('toggles between collapsed and expanded states', () => {
    render(
      <CollapsibleSidebar title="Test Sidebar">
        <div data-testid="content">Sidebar Content</div>
      </CollapsibleSidebar>
    );

    // Initially expanded
    expect(screen.getByTestId('content')).toBeInTheDocument();

    // Click collapse button
    const toggleButton = screen.getByLabelText('Collapse sidebar');
    fireEvent.click(toggleButton);

    // Content should be hidden
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();

    // Click expand button (aria-label changes)
    const expandButton = screen.getByLabelText('Expand sidebar');
    fireEvent.click(expandButton);

    // Content should be visible again
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('uses custom title when provided', () => {
    render(
      <CollapsibleSidebar title="Custom Title">
        <div>Content</div>
      </CollapsibleSidebar>
    );

    expect(screen.getByText('Custom Title')).toBeInTheDocument();
  });

  it('renders children correctly', () => {
    render(
      <CollapsibleSidebar>
        <div data-testid="child1">Child 1</div>
        <div data-testid="child2">Child 2</div>
      </CollapsibleSidebar>
    );

    expect(screen.getByTestId('child1')).toBeInTheDocument();
    expect(screen.getByTestId('child2')).toBeInTheDocument();
  });

  it('applies correct width in expanded state', () => {
    const { container } = render(
      <CollapsibleSidebar width={600}>
        <div>Content</div>
      </CollapsibleSidebar>
    );

    const sidebar = container.firstChild as HTMLElement;
    expect(sidebar).toHaveStyle('width: 600px');
    expect(sidebar).toHaveStyle('min-width: 600px');
  });

  it('applies correct width in collapsed state', () => {
    const { container } = render(
      <CollapsibleSidebar width={600} collapsedWidth={48} defaultCollapsed={true}>
        <div>Content</div>
      </CollapsibleSidebar>
    );

    const sidebar = container.firstChild as HTMLElement;
    expect(sidebar).toHaveStyle('width: 48px');
    expect(sidebar).toHaveStyle('min-width: 48px');
  });

  it('renders icons in collapsed state', () => {
    render(
      <CollapsibleSidebar defaultCollapsed={true}>
        <div>Content</div>
      </CollapsibleSidebar>
    );

    // Should show file code icon
    expect(screen.getByTitle('Ontology Editor')).toBeInTheDocument();
  });

  it('has accessible toggle button', () => {
    render(
      <CollapsibleSidebar title="Test">
        <div>Content</div>
      </CollapsibleSidebar>
    );

    const toggleButton = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggleButton).toBeInTheDocument();
  });

  it('transitions smoothly between states', () => {
    const { container } = render(
      <CollapsibleSidebar>
        <div>Content</div>
      </CollapsibleSidebar>
    );

    const sidebar = container.firstChild as HTMLElement;
    expect(sidebar).toHaveClass('transition-all');
    expect(sidebar).toHaveClass('duration-300');
    expect(sidebar).toHaveClass('ease-in-out');
  });
});
