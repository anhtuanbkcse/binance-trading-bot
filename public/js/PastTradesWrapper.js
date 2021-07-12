/* eslint-disable no-unused-vars */
/* eslint-disable react/jsx-no-undef */
/* eslint-disable no-undef */
class PastTradesWrapper extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      canUpdate: true,
      pastTrades: {}
    };

    this.setUpdate = this.setUpdate.bind(this);
  }

  componentDidUpdate(nextProps) {
    // Only update, when the canUpdate is true.
    const { canUpdate } = this.state;
    if (
      canUpdate === true &&
      _.get(nextProps, 'symbols', null) !== null &&
      _.isEqual(_.get(nextProps, 'symbols', null), this.state.symbols) === false
    ) {


      console.log("Can update")

    }
  }

  setUpdate(newStatus) {
    this.setState({
      canUpdate: newStatus
    });
  }

  render() {
    const { jsonStrings, pastTrades } = this.props;

    if (_.isEmpty(jsonStrings)) {
      return '';
    }
    const { profit_loss_wrapper, common_strings } = jsonStrings;

    const trades = Object.values(pastTrades).map((trade, index) => {

      const profitIsNegative = Math.sign(trade.profit);
      let classNameExtension = '';
      if (profitIsNegative === 1) {
        classNameExtension = ' past-trades-profit'
      }
      if (profitIsNegative === -1) {
        classNameExtension = ' past-trades-loss'
      }
      return (
        <div
          key={`past-trade-` + index}
          className={'profit-loss-wrapper pt-2 pl-2 pr-2 pb-0' + classNameExtension}>
          <div className='profit-loss-wrapper-body'>
            <span className='profit-loss-asset'>{trade.symbol}</span>{' '}
            <span className='profit-loss-value'>
              {trade.profit}
              {trade.date}
            </span>
          </div>
        </div>
      );
    });


    return (
      <div className='accordion-wrapper profit-loss-accordion-wrapper'>
        <Accordion eventKey='0'>
          <Card>
            <Accordion.Toggle
              as={Card.Header}
              eventKey='0'
              className='px-2 py-1'>
              <button
                type='button'
                className='btn btn-sm btn-link btn-status text-uppercase font-weight-bold'>
                Past Trades
              </button>
            </Accordion.Toggle>

            <Accordion.Collapse eventKey='0'>
              <Card.Body className='d-flex flex-column py-2 px-0 card-body'>
                <div className='profit-loss-wrappers info-wrapper d-flex flex-row flex-wrap justify-content-start'>
                  {_.isEmpty(pastTrades) ? (
                    <div className='text-center w-100'>
                      <Spinner animation='border' role='status'>
                        <span className='sr-only'>Not trades yet...</span>
                      </Spinner>
                    </div>
                  ) : (
                    trades
                  )}
                </div>
              </Card.Body>
            </Accordion.Collapse>
          </Card>
        </Accordion>
      </div>
    );
  }
}