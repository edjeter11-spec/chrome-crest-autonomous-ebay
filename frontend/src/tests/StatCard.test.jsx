import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatCard from '../components/StatCard'
import { Activity } from 'lucide-react'

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard label="Live Auctions" value={42} />)
    expect(screen.getByText('Live Auctions')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('renders sub text when provided', () => {
    render(<StatCard label="Score" value={88} sub="avg snipe score" />)
    expect(screen.getByText('avg snipe score')).toBeInTheDocument()
  })

  it('renders skeleton when value is undefined', () => {
    const { container } = render(<StatCard label="Loading" value={undefined} />)
    expect(container.querySelector('.skeleton')).toBeTruthy()
  })

  it('renders icon when passed', () => {
    const { container } = render(<StatCard label="Activity" value={5} icon={Activity} />)
    // lucide renders an svg
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('applies blue color scheme by default', () => {
    const { container } = render(<StatCard label="Test" value={1} icon={Activity} />)
    expect(container.innerHTML).toContain('blue')
  })

  it('applies green color scheme', () => {
    const { container } = render(<StatCard label="Test" value={1} color="green" icon={Activity} />)
    expect(container.innerHTML).toContain('green')
  })

  it('applies red color scheme', () => {
    const { container } = render(<StatCard label="Test" value={1} color="red" icon={Activity} />)
    expect(container.innerHTML).toContain('red')
  })

  it('applies yellow color scheme', () => {
    const { container } = render(<StatCard label="Test" value={1} color="yellow" icon={Activity} />)
    expect(container.innerHTML).toContain('yellow')
  })

  it('falls back to blue for unknown color', () => {
    const { container } = render(<StatCard label="Test" value={1} color="magenta" icon={Activity} />)
    expect(container.innerHTML).toContain('blue')
  })

  it('renders numeric zero as 0, not skeleton', () => {
    render(<StatCard label="Bids" value={0} />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})
