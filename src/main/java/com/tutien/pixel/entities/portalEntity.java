package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name = "portals")
public class portalEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private String denMap;
    @Column(length = 100, unique = true)
    private String idMap;
    private int x;
    private int y;
    private int toX;
    private int toY;
    @ManyToOne
    @JoinColumn(name = "map_id")
    private worldEntity map;
}
