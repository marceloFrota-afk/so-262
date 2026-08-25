/** Implementa o buffer limitado compartilhado entre produtor e consumidor. */
public class BoundedBuffer implements Buffer {
    private static final int BUFFER_SIZE = 3;
    private volatile int count;
    private int in;
    private int out;
    private Object[] buffer;

    public BoundedBuffer() {
        count = 0;
        in = 0;
        out = 0;
        buffer = new Object[BUFFER_SIZE];
    }

    public void insert(Object item) {
        while (count == BUFFER_SIZE)
            ;

        ++count;
        buffer[in] = item;
        in = (in + 1) % BUFFER_SIZE;

        if (count == BUFFER_SIZE)
            System.out.println("Producer Entered " + item + " Buffer FULL");
        else
            System.out.println("Producer Entered " + item + " Buffer Size = " + count);
    }

    public Object remove() {
        Object item;

        while (count == 0)
            ;

        --count;
        item = buffer[out];
        out = (out + 1) % BUFFER_SIZE;

        if (count == 0)
            System.out.println("Consumer Consumed " + item + " Buffer EMPTY");
        else
            System.out.println("Consumer Consumed " + item + " Buffer Size = " + count);

        return item;
    }
}
